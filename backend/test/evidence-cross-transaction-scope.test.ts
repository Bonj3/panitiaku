import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/config/database.js';
import {
  app,
  ensureCsrf,
  sharedCsrf,
  makeAgent,
  makeEventAndMembership,
  createTx,
  cleanupTestData,
} from './finance.helpers.js';
import supertest from 'supertest';
import {
  setStorageProviderForTest,
  resetStorageProviderForTest,
} from '../src/modules/storage/s3-storage-provider.js';
import type { StorageProvider } from '../src/modules/storage/storage.provider.js';
import { uploadEvidence } from '../src/modules/finance/evidence.service.js';

const ORIGIN = 'http://localhost:5173';

function cookieHeader(tokenPlain: string, csrfToken: string): string {
  return `ec_csrf=${csrfToken}; ec_session=${tokenPlain}`;
}

/** GET signed URL untuk bukti (scope: eventId + txId + evidenceId). */
async function getSignedUrlApi(
  tokenPlain: string,
  eventId: string,
  txId: string,
  evidenceId: string
) {
  return supertest(app)
    .get(`/api/v1/events/${eventId}/transactions/${txId}/evidence/${evidenceId}/url`)
    .set('Origin', ORIGIN)
    .set('Cookie', cookieHeader(tokenPlain, sharedCsrf));
}

/** PATCH flag sensitive (scope: eventId + txId + evidenceId; mutating → butuh CSRF). */
async function patchSensitiveApi(
  tokenPlain: string,
  eventId: string,
  txId: string,
  evidenceId: string,
  sensitive: boolean
) {
  return supertest(app)
    .patch(`/api/v1/events/${eventId}/transactions/${txId}/evidence/${evidenceId}/sensitive`)
    .set('Origin', ORIGIN)
    .set('Cookie', cookieHeader(tokenPlain, sharedCsrf))
    .set('X-CSRF-Token', sharedCsrf)
    .send({ sensitive });
}

/** GET audit logs (hanya EVENT_CHAIR; query entityId divalidasi UUID). */
async function listAuditLogsApi(
  tokenPlain: string,
  eventId: string,
  query?: Record<string, string>
) {
  const url = new URL(`/api/v1/events/${eventId}/audit-logs`, 'http://localhost');
  if (query) for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  return supertest(app)
    .get(url.pathname + url.search)
    .set('Origin', ORIGIN)
    .set('Cookie', cookieHeader(tokenPlain, sharedCsrf));
}

function pdfBuffer(): Buffer {
  return Buffer.from('%PDF-1.4\n%fake pdf\n%%EOF\n', 'utf8');
}

const files = new Map<string, Buffer>();
const fakeStorageProvider: StorageProvider = {
  async put({ key, body }) {
    files.set(key, body as Buffer);
    return { key };
  },
  async delete({ key }) {
    files.delete(key);
  },
  async signedGetUrl({ key, ttlSeconds = 600 }) {
    if (!files.has(key)) throw new Error('berkas tidak tersedia');
    return {
      url: `http://localhost/storage/${key}`,
      expiresAt: new Date(Date.now() + ttlSeconds * 1000),
    };
  },
  isAvailable(): boolean {
    return true;
  },
};

/**
 * Siapkan satu event (Chair), dua transaksi (T1, T2) dalam event yang sama,
 * dan satu evidence untuk masing-masing transaksi (E1 → T1, E2 → T2).
 */
async function seedTwoTxAndEvidence() {
  const chair = await makeAgent('EVENT_CHAIR');
  const { eventId, membershipId } = await makeEventAndMembership(chair.id);

  const r1 = await createTx(chair.tokenPlain, eventId, {
    type: 'EXPENSE',
    category: 'VENUE',
    description: 'beli alat 1',
    amount: '500000.00',
  });
  expect(r1.status).toBe(201);
  const tx1Id = r1.body.data.id;

  const r2 = await createTx(chair.tokenPlain, eventId, {
    type: 'EXPENSE',
    category: 'VENUE',
    description: 'beli alat 2',
    amount: '600000.00',
  });
  expect(r2.status).toBe(201);
  const tx2Id = r2.body.data.id;

  const e1 = await uploadEvidence(
    eventId,
    tx1Id,
    membershipId,
    {
      fileKey: 'unused',
      originalName: 'bukti1.pdf',
      mimeType: 'application/pdf',
      sizeBytes: pdfBuffer().length,
      buffer: pdfBuffer(),
    },
    false
  );
  const e2 = await uploadEvidence(
    eventId,
    tx2Id,
    membershipId,
    {
      fileKey: 'unused',
      originalName: 'bukti2.pdf',
      mimeType: 'application/pdf',
      sizeBytes: pdfBuffer().length,
      buffer: pdfBuffer(),
    },
    false
  );

  return {
    chair,
    eventId,
    membershipId,
    tx1Id,
    tx2Id,
    e1Id: e1.id,
    e2Id: e2.id,
    tokenPlain: chair.tokenPlain,
  };
}

beforeAll(async () => {
  await prisma.$connect();
  await ensureCsrf();
  setStorageProviderForTest(fakeStorageProvider);
  files.clear();
});

beforeEach(() => {
  files.clear();
});

afterAll(async () => {
  await cleanupTestData();
  resetStorageProviderForTest();
  files.clear();
  await prisma.$disconnect();
});

// ===========================================================================
// Reviewer poin 1: signed URL + sensitive update harusScoped ke txId DAN
// eventId. Bukti milik transaksi lain dalam event yang sama → 404 (IDOR
// lintas-transaksi). Upload dan list sudahScoped per transaksi (dikomentari).
// ===========================================================================
describe('Evidence: signed URL dan update sensitive scoped ke txId + eventId', () => {
  it('signed URL bukti milik transaksi lain (event sama) → 404, tidak bocorkan bukti T2 melalui T1', async () => {
    const { eventId, tx1Id, e2Id, tokenPlain } = await seedTwoTxAndEvidence();

    // E2 milik T2, diminta melalui endpoint T1, event sama → harus 404.
    const res = await getSignedUrlApi(tokenPlain, eventId, tx1Id, e2Id);
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('update sensitive bukti milik transaksi lain (event sama) → 404', async () => {
    const { eventId, tx1Id, e2Id, tokenPlain } = await seedTwoTxAndEvidence();

    const res = await patchSensitiveApi(tokenPlain, eventId, tx1Id, e2Id, true);
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('signed URL bukti milik transaksi yang sama → 200 (scope yang benar tetap bekerja)', async () => {
    const { eventId, tx1Id, e1Id, tokenPlain } = await seedTwoTxAndEvidence();

    const res = await getSignedUrlApi(tokenPlain, eventId, tx1Id, e1Id);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.url).toContain('/storage/');
    expect(res.body.data.evidence.id).toBe(e1Id);
  });

  it('update sensitive bukti milik transaksi yang sama → 200', async () => {
    const { eventId, tx1Id, e1Id, tokenPlain } = await seedTwoTxAndEvidence();

    const res = await patchSensitiveApi(tokenPlain, eventId, tx1Id, e1Id, true);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.sensitive).toBe(true);
    expect(res.body.data.id).toBe(e1Id);
    expect(res.body.data.transactionId).toBe(tx1Id);
  });

  it('list evidence tetap scoped per transaksi: T1 tidak mengembalikan E2 milik T2', async () => {
    const { eventId, tx1Id, e1Id, tokenPlain } = await seedTwoTxAndEvidence();

    const res = await supertest(app)
      .get(`/api/v1/events/${eventId}/transactions/${tx1Id}/evidence`)
      .set('Origin', ORIGIN)
      .set('Cookie', cookieHeader(tokenPlain, sharedCsrf));
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.items).toHaveLength(1);
    expect(res.body.data.items[0].id).toBe(e1Id);
    expect(res.body.data.items[0].transactionId).toBe(tx1Id);
    expect(res.body.data.items[0]).not.toHaveProperty('fileKey');
  });

  it('upload evidence terikat transaksi yang diminta (txId) dan event (eventId)', async () => {
    const { eventId, membershipId, tokenPlain } = await seedTwoTxAndEvidence();

    const r = await createTx(tokenPlain, eventId, {
      type: 'INCOME',
      category: 'SPONSORSHIP',
      description: 'dana baru',
      amount: '1000000.00',
    });
    expect(r.status).toBe(201);
    const tx3Id = r.body.data.id;

    const e3 = await uploadEvidence(
      eventId,
      tx3Id,
      membershipId,
      {
        fileKey: 'unused',
        originalName: 'bukti3.pdf',
        mimeType: 'application/pdf',
        sizeBytes: pdfBuffer().length,
        buffer: pdfBuffer(),
      },
      false
    );
    expect(e3.transactionId).toBe(tx3Id);

    const stored = await prisma.transactionEvidence.findUnique({ where: { id: e3.id } });
    expect(stored).toBeDefined();
    expect(stored!.transactionId).toBe(tx3Id);
  });
});

// ===========================================================================
// Reviewer poin 2: audit entityId filter harus divalidasi UUID (semua
// entitas — event, member, invitation, transaction, evidence, ledger_entry —
// pakai UUID PK). Non-UUID → 422 UNPROCESSABLE.
// ===========================================================================
describe('Audit: entityId filter wajib UUID', () => {
  it('entityId bukan UUID → 422 UNPROCESSABLE', async () => {
    const chair = await makeAgent('EVENT_CHAIR');
    const { eventId } = await makeEventAndMembership(chair.id);

    const res = await listAuditLogsApi(chair.tokenPlain, eventId, {
      entityId: 'not-a-uuid',
    });
    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('UNPROCESSABLE');
    const details = JSON.stringify(res.body.error.details);
    expect(details).toContain('entityId');
  });

  it('entityId UUID valid → 200 (lolos validasi; hasil mungkin kosong)', async () => {
    const chair = await makeAgent('EVENT_CHAIR');
    const { eventId } = await makeEventAndMembership(chair.id);

    const fakeUuid = '00000000-0000-0000-0000-000000000000';
    const res = await listAuditLogsApi(chair.tokenPlain, eventId, {
      entityId: fakeUuid,
    });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data.items)).toBe(true);
    expect(res.body.data.meta).toBeDefined();
  });

  it('entityId tidak disertakan → 200 (opsional)', async () => {
    const chair = await makeAgent('EVENT_CHAIR');
    const { eventId } = await makeEventAndMembership(chair.id);

    const res = await listAuditLogsApi(chair.tokenPlain, eventId);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});
