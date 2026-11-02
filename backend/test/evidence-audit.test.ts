import { hash } from '@node-rs/argon2';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../src/config/database.js';
import { hashToken } from '../src/shared/utils/token.js';
import {
  app,
  ensureCsrf,
  sharedCsrf,
  makeAgent,
  makeEventAndMembership,
  createTx,
  submitTx,
  approveTx,
  payTx,
  reverseTx,
  rejectTxRaw,
  getDetail,
  listEvidence,
  cleanupTestData,
  testUserIds,
} from './finance.helpers.js';
import supertest from 'supertest';
import {
  setStorageProviderForTest,
  resetStorageProviderForTest,
} from '../src/modules/storage/s3-storage-provider.js';
import type { StorageProvider } from '../src/modules/storage/storage.provider.js';
import {
  sanitizeMetaValue,
  sanitizeAuditMetadata,
  AUDIT_ROLE_ENUM,
} from '../src/shared/utils/pii-redaction.js';
import {
  sanitizeOriginalName,
  MAX_ORIGINAL_NAME_LEN,
} from '../src/shared/utils/file-validation.js';
import { uploadEvidence, getEvidenceSignedUrl } from '../src/modules/finance/evidence.service.js';

const ORIGIN = 'http://localhost:5173';

function cookieHeader(tokenPlain: string, csrfToken: string): string {
  return `ec_csrf=${csrfToken}; ec_session=${tokenPlain}`;
}

async function createInvitationViaApi(
  tokenPlain: string,
  csrfToken: string,
  eventId: string,
  input: any
) {
  return supertest(app)
    .post(`/api/v1/events/${eventId}/invitations`)
    .set('Origin', ORIGIN)
    .set('Cookie', cookieHeader(tokenPlain, csrfToken))
    .set('X-CSRF-Token', csrfToken)
    .send(input);
}
async function listInvitationsViaApi(tokenPlain: string, csrfToken: string, eventId: string) {
  return supertest(app)
    .get(`/api/v1/events/${eventId}/invitations`)
    .set('Origin', ORIGIN)
    .set('Cookie', cookieHeader(tokenPlain, csrfToken));
}
async function publicDetailViaApi(token: string) {
  return supertest(app).get(`/api/v1/invitations/${token}`).set('Origin', ORIGIN);
}
async function acceptViaApi(tokenPlain: string, csrfToken: string, token: string) {
  return supertest(app)
    .post(`/api/v1/invitations/${token}/accept`)
    .set('Origin', ORIGIN)
    .set('Cookie', cookieHeader(tokenPlain, csrfToken))
    .set('X-CSRF-Token', csrfToken)
    .send({});
}

beforeAll(async () => {
  await prisma.$connect();
  await ensureCsrf();
});

afterAll(async () => {
  await cleanupTestData();
  await prisma.$disconnect();
});

// ===========================================================================
// Invitation expiry + audit (expireStale / public lazy expiry / accept)
// ===========================================================================
describe('Invitation expiry + audit', () => {
  it('expireStale via GET invitations: PENDING expired → EXPIRED + single audit invitation.expire; no duplicate on re-call', async () => {
    const chair = await makeAgent('EVENT_CHAIR');
    const { eventId, membershipId } = await makeEventAndMembership(chair.id);

    const email = `inv.expire.${Date.now()}@example.com`;
    const res = await createInvitationViaApi(chair.tokenPlain, sharedCsrf, eventId, {
      email,
      role: 'MEMBER',
      parentId: membershipId,
    });
    if (res.status !== 201) throw new Error('create invitation gagal: ' + JSON.stringify(res.body));
    expect(res.status).toBe(201);
    const invitationId = res.body.data.invitation.id;
    const invitedById = res.body.data.invitation.invitedById;

    // Paksa expired di DB.
    await prisma.invitation.update({
      where: { id: invitationId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const listRes = await listInvitationsViaApi(chair.tokenPlain, sharedCsrf, eventId);
    if (listRes.status !== 200)
      throw new Error('list invitations gagal: ' + JSON.stringify(listRes.body));
    expect(listRes.status).toBe(200);
    const item = listRes.body.data.items.find((i: any) => i.id === invitationId);
    expect(item).toBeDefined();
    expect(item.status).toBe('EXPIRED');

    const audits = await prisma.auditLog.findMany({
      where: {
        eventId,
        action: 'invitation.expire',
        entityType: 'invitation',
        entityId: invitationId,
      },
    });
    expect(audits.length).toBe(1);
    expect(audits[0].actorId).toBe(invitedById);
    expect(audits[0].metadata).toEqual({ trigger: 'automatic_ttl' });

    // Panggil ulang → tidak ada audit duplikat (sudah EXPIRED, conditional update count = 0).
    await listInvitationsViaApi(chair.tokenPlain, sharedCsrf, eventId);
    const audits2 = await prisma.auditLog.findMany({
      where: {
        eventId,
        action: 'invitation.expire',
        entityType: 'invitation',
        entityId: invitationId,
      },
    });
    expect(audits2.length).toBe(1);
  });

  it('expireStale conditional update: sudah final (ACCEPTED) → tidak ada perubahan, tidak ada audit', async () => {
    // Cabang `updated.count !== 1 → return false` di expireStale dapat dipaksa
    // deterministik dengan men-set status final di DB sebelum expireStale berjalan.
    const chair = await makeAgent('EVENT_CHAIR');
    const { eventId, membershipId } = await makeEventAndMembership(chair.id);
    const email = `inv.race.${Date.now()}@example.com`;
    const res = await createInvitationViaApi(chair.tokenPlain, sharedCsrf, eventId, {
      email,
      role: 'MEMBER',
      parentId: membershipId,
    });
    expect(res.status).toBe(201);
    const invitationId = res.body.data.invitation.id;
    await prisma.invitation.update({
      where: { id: invitationId },
      data: {
        expiresAt: new Date(Date.now() - 1000),
        status: 'ACCEPTED',
        acceptedById: chair.id,
        acceptedAt: new Date(),
      },
    });

    const listRes = await listInvitationsViaApi(chair.tokenPlain, sharedCsrf, eventId);
    expect(listRes.status).toBe(200);
    const item = listRes.body.data.items.find((i: any) => i.id === invitationId);
    expect(item.status).toBe('ACCEPTED');

    const audits = await prisma.auditLog.findMany({
      where: {
        eventId,
        action: 'invitation.expire',
        entityType: 'invitation',
        entityId: invitationId,
      },
    });
    expect(audits.length).toBe(0);
  });

  it('public GET expired token → 410 + audit invitation.expire; metadata without PII', async () => {
    const chair = await makeAgent('EVENT_CHAIR');
    const { eventId, membershipId } = await makeEventAndMembership(chair.id);
    const email = `inv.pub.${Date.now()}@example.com`;
    const res = await createInvitationViaApi(chair.tokenPlain, sharedCsrf, eventId, {
      email,
      role: 'MEMBER',
      parentId: membershipId,
    });
    expect(res.status).toBe(201);
    const invitationId = res.body.data.invitation.id;
    const tokenPlain = res.body.data.token;

    await prisma.invitation.update({
      where: { id: invitationId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const pubRes = await publicDetailViaApi(tokenPlain);
    if (pubRes.status !== 410)
      throw new Error(
        'public detail expired harapan=410 aktual=' +
          pubRes.status +
          ' body=' +
          JSON.stringify(pubRes.body)
      );
    expect(pubRes.status).toBe(410);
    expect(pubRes.body.success).toBe(false);

    const audits = await prisma.auditLog.findMany({
      where: {
        eventId,
        action: 'invitation.expire',
        entityType: 'invitation',
        entityId: invitationId,
      },
    });
    expect(audits.length).toBe(1);
    expect(audits[0].actorId).toBe(membershipId);
    expect(audits[0].metadata).toEqual({ trigger: 'automatic_ttl' });

    const metaStr = JSON.stringify(audits[0].metadata);
    expect(metaStr).not.toContain(email);
    expect(metaStr).not.toContain(tokenPlain);
    expect(metaStr).not.toContain('tokenHash');
  });

  it('accept expired invitation → 410 + tepat satu audit invitation.expire', async () => {
    const chair = await makeAgent('EVENT_CHAIR');
    const { eventId, membershipId } = await makeEventAndMembership(chair.id);
    const email = `fin.invitee.${Date.now()}@example.com`;
    const res = await createInvitationViaApi(chair.tokenPlain, sharedCsrf, eventId, {
      email,
      role: 'MEMBER',
      parentId: membershipId,
    });
    expect(res.status).toBe(201);
    const invitationId = res.body.data.invitation.id;
    const tokenPlain = res.body.data.token;

    await prisma.invitation.update({
      where: { id: invitationId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    // User dengan email yang cocok (accept butuh email match).
    const passwordHash = await hash('password123');
    const user = await prisma.user.create({ data: { name: 'Invitee', email, passwordHash } });
    testUserIds.push(user.id);
    const userToken = `tok_acc_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    await prisma.session.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(userToken),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        ip: null,
        userAgent: null,
      },
    });

    const accRes = await acceptViaApi(userToken, sharedCsrf, tokenPlain);
    if (accRes.status !== 410)
      throw new Error(
        'accept expired harapan=410 aktual=' +
          accRes.status +
          ' body=' +
          JSON.stringify(accRes.body)
      );
    expect(accRes.status).toBe(410);

    const audits = await prisma.auditLog.findMany({
      where: {
        eventId,
        action: 'invitation.expire',
        entityType: 'invitation',
        entityId: invitationId,
      },
    });
    expect(audits.length).toBe(1);
  });
});

// ===========================================================================
// PII sanitizer: reject reason & reverse narration
// ===========================================================================
describe('PII sanitizer in free-text finance fields', () => {
  const piiReason =
    'Bayar ke rekening 1234567890123456 hubungi john.doe@example.com atau 08123456789. ' +
    'Bukti: https://example.com/proof?token=abc123';

  it('reject reason with PII → redacted in rejectReason + transaction_history.note', async () => {
    const chair = await makeAgent('EVENT_CHAIR');
    const { eventId } = await makeEventAndMembership(chair.id);

    const r = await createTx(chair.tokenPlain, eventId, {
      type: 'EXPENSE',
      category: 'VENUE',
      description: 'beli alat',
      amount: '500000.00',
    });
    expect(r.status).toBe(201);
    const txId = r.body.data.id;
    await submitTx(chair.tokenPlain, eventId, txId);

    const rej = await rejectTxRaw(chair.tokenPlain, eventId, txId, { reason: piiReason });
    if (rej.status !== 200)
      throw new Error(
        'reject harapan=200 aktual=' + rej.status + ' body=' + JSON.stringify(rej.body)
      );
    expect(rej.status).toBe(200);

    const detail = await getDetail(chair.tokenPlain, eventId, txId);
    expect(detail.status).toBe(200);
    const rejReason: string | null = detail.body.data.rejectReason;
    expect(rejReason).not.toContain('john.doe@example.com');
    expect(rejReason).not.toContain('08123456789');
    expect(rejReason).not.toContain('1234567890123456');
    expect(rejReason).not.toContain('https://example.com/proof?token=abc123');
    expect(rejReason).toContain('[EMAIL_DISANDINGKAN]');
    expect(rejReason).toContain('[URL_TOKEN_DISANDINGKAN]');

    const hist = await prisma.transactionHistory.findMany({
      where: { transactionId: txId, toStatus: 'REJECTED' },
      orderBy: { createdAt: 'desc' },
      take: 1,
    });
    expect(hist.length).toBe(1);
    const note = String(hist[0].note);
    expect(note).not.toContain('john.doe@example.com');
    expect(note).not.toContain('08123456789');
    expect(note).not.toContain('1234567890123456');
    expect(note).not.toContain('https://example.com/proof?token=abc123');
  });

  it('reverse narration with PII → redacted in ledger_entries.narration', async () => {
    const chair = await makeAgent('EVENT_CHAIR');
    const { eventId } = await makeEventAndMembership(chair.id);
    const reason =
      'Transfer salah ke 1234567890123456 hubungi jane.doe@example.com atau 08129876543. ' +
      'https://example.com/proof?token=xyz789';

    const r = await createTx(chair.tokenPlain, eventId, {
      type: 'INCOME',
      category: 'SPONSORSHIP',
      description: 'dana',
      amount: '5000000.00',
    });
    expect(r.status).toBe(201);
    const txId = r.body.data.id;
    await submitTx(chair.tokenPlain, eventId, txId);
    await approveTx(chair.tokenPlain, eventId, txId);
    await payTx(chair.tokenPlain, eventId, txId);

    const rev = await reverseTx(chair.tokenPlain, eventId, txId, reason);
    if (rev.status !== 201)
      throw new Error(
        'reverse harapan=201 aktual=' + rev.status + ' body=' + JSON.stringify(rev.body)
      );
    expect(rev.status).toBe(201);

    const ledger = await prisma.ledgerEntry.findMany({
      where: { transactionId: txId, reversalOfId: { not: null } },
    });
    expect(ledger.length).toBe(1);
    const narration: string | null = ledger[0].narration;
    expect(narration).not.toContain('jane.doe@example.com');
    expect(narration).not.toContain('08129876543');
    expect(narration).not.toContain('1234567890123456');
    expect(narration).not.toContain('https://example.com/proof?token=xyz789');
    expect(narration).toContain('[EMAIL_DISANDINGKAN]');
    expect(narration).toContain('[URL_TOKEN_DISANDINGKAN]');
  });
});

// ===========================================================================
// sanitizeOriginalName: PII + path traversal + max length
// ===========================================================================
describe('sanitizeOriginalName: PII, path traversal, max length', () => {
  it('redaksi email, telepon, digit panjang; simpan ekstensi', () => {
    const out = sanitizeOriginalName('bukti john.doe@example.com 1234567890123456 08123456789.pdf');
    expect(out).not.toContain('john.doe@example.com');
    expect(out).not.toContain('1234567890123456');
    expect(out).not.toContain('08123456789');
    // redactNote menyisipkan penanda [EMAIL_DISANDINGKAN], lalu langkah
    // sanitasi nama berkas menghapus tanda kurung (bukan [\w._-]), sehingga
    // penanda tersisa sebagai _EMAIL_DISANDINGKAN_. PII sudah hilang.
    expect(out).toContain('EMAIL_DISANDINGKAN');
    expect(out.endsWith('.pdf')).toBe(true);
  });

  it('mencegah path traversal, hanya basename yang dipertahankan', () => {
    expect(sanitizeOriginalName('../../../etc/passwd')).toBe('passwd');
    expect(sanitizeOriginalName('C:\\Users\\john\\file.pdf')).toBe('file.pdf');
  });

  it('ganti karakter berbahaya, simpan titik/garis bawah/strip', () => {
    const out = sanitizeOriginalName('evidence; rm -rf /report.pdf');
    expect(out).not.toContain(';');
    expect(out).not.toContain('/');
    expect(out.endsWith('.pdf')).toBe(true);
  });

  it('batasi panjang dan tetap simpan ekstensi', () => {
    const out = sanitizeOriginalName('a'.repeat(300) + '.pdf');
    expect(out.length).toBeLessThanOrEqual(MAX_ORIGINAL_NAME_LEN);
    expect(out.endsWith('.pdf')).toBe(true);
    expect(out).toContain('...');
  });
});

// ===========================================================================
// audit metadata sanitizer: fromRole/toRole hanya enum role, status hanya ACTIVE/INACTIV
// ===========================================================================
describe('audit metadata sanitizer: role/status enum-only', () => {
  const META_KEYS = new Set([
    'fromStatus',
    'toStatus',
    'fromRole',
    'toRole',
    'field',
    'fields',
    'cancelledCount',
    'isPaymentProof',
    'sensitive',
    'sizeBytes',
    'mimeType',
    'evidenceId',
    'transactionId',
    'role',
    'parentId',
    'trigger',
  ]);

  it('fromRole/toRole hanya terima role enum, tolak string bebas', () => {
    expect(sanitizeMetaValue('fromRole', 'EVENT_CHAIR')).toBe('EVENT_CHAIR');
    expect(sanitizeMetaValue('toRole', 'MEMBER')).toBe('MEMBER');
    expect(sanitizeMetaValue('toRole', 'DIVISION_LEADER')).toBe('DIVISION_LEADER');
    expect(sanitizeMetaValue('fromRole', 'SUPER_ADMIN')).toBeNull();
    expect(sanitizeMetaValue('toRole', 'arbitrary-string')).toBeNull();
  });

  it('fromStatus/toStatus terima ACTIVE/INACTIVE, tolak string bebas', () => {
    expect(sanitizeMetaValue('fromStatus', 'ACTIVE')).toBe('ACTIVE');
    expect(sanitizeMetaValue('toStatus', 'INACTIVE')).toBe('INACTIVE');
    expect(sanitizeMetaValue('fromStatus', 'arbitrary-status')).toBeNull();
    expect(sanitizeMetaValue('toStatus', 'DRAFT-SOMETHING')).toBeNull();
  });

  it('sanitizeAuditMetadata mempertahankan fromRole/toRole/status, buang PII dan kunci non-whitelist', () => {
    const out = sanitizeAuditMetadata(
      {
        fromRole: 'EVENT_CHAIR',
        toRole: 'MEMBER',
        fromStatus: 'ACTIVE',
        toStatus: 'INACTIVE',
        originalName: 'john.doe@example.com 1234567890123456.pdf',
        fileKey: 'deadbeef',
        arbitrary: 'tidak boleh ada',
        email: 'jane.doe@example.com',
      },
      META_KEYS
    );
    expect(out).toEqual({
      fromRole: 'EVENT_CHAIR',
      toRole: 'MEMBER',
      fromStatus: 'ACTIVE',
      toStatus: 'INACTIVE',
    });
    const metaStr = JSON.stringify(out);
    expect(metaStr).not.toContain('originalName');
    expect(metaStr).not.toContain('fileKey');
    expect(metaStr).not.toContain('arbitrary');
    expect(metaStr).not.toContain('john.doe@example.com');
    expect(metaStr).not.toContain('jane.doe@example.com');
    expect(metaStr).not.toContain('1234567890123456');
  });

  it('AUDIT_ROLE_ENUM hanya berisi role aplikasi', () => {
    expect(AUDIT_ROLE_ENUM.has('EVENT_CHAIR')).toBe(true);
    expect(AUDIT_ROLE_ENUM.has('DIVISION_LEADER')).toBe(true);
    expect(AUDIT_ROLE_ENUM.has('MEMBER')).toBe(true);
    expect(AUDIT_ROLE_ENUM.has('SUPER_ADMIN')).toBe(false);
    expect(AUDIT_ROLE_ENUM.has('arbitrary')).toBe(false);
  });
});

// ===========================================================================
// Evidence: originalName PII sanitization — persistensi + respons (upload & signed URL)
// ===========================================================================
describe('Evidence: originalName PII sanitization (upload + signed URL)', () => {
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

  beforeAll(() => {
    setStorageProviderForTest(fakeStorageProvider);
    files.clear();
  });
  afterAll(() => {
    resetStorageProviderForTest();
    files.clear();
  });

  async function seedChairAndDraftTx() {
    const chair = await makeAgent('EVENT_CHAIR');
    const { eventId, membershipId } = await makeEventAndMembership(chair.id);
    const r = await createTx(chair.tokenPlain, eventId, {
      type: 'EXPENSE',
      category: 'VENUE',
      description: 'beli alat',
      amount: '500000.00',
    });
    expect(r.status).toBe(201);
    return { chair, eventId, membershipId, txId: r.body.data.id };
  }

  function pdfBuffer(): Buffer {
    return Buffer.from('%PDF-1.4\n%fake pdf\n%%EOF\n', 'utf8');
  }

  it('upload menyimpan originalName yang sudah di-redaksi PII dan audit tidak menyertakan nama file', async () => {
    const { eventId, membershipId, txId } = await seedChairAndDraftTx();

    const originalName = 'bukti john.doe@example.com 1234567890123456 08123456789.pdf';

    const evidence = await uploadEvidence(
      eventId,
      txId,
      membershipId,
      {
        fileKey: 'unused',
        originalName,
        mimeType: 'application/pdf',
        sizeBytes: pdfBuffer().length,
        buffer: pdfBuffer(),
      },
      false
    );

    // Respons (via toEvidenceMetadata) sudah bersih PII.
    expect(evidence.originalName).not.toContain('john.doe@example.com');
    expect(evidence.originalName).not.toContain('1234567890123456');
    expect(evidence.originalName).not.toContain('08123456789');
    expect(evidence.originalName).toContain('EMAIL_DISANDINGKAN');
    expect(evidence.originalName.endsWith('.pdf')).toBe(true);

    // DB juga menyimpan nilai yang sudah di-sanitasi.
    const stored = await prisma.transactionEvidence.findUnique({
      where: { id: evidence.id },
    });
    expect(stored).toBeDefined();
    expect(stored!.originalName).toBe(evidence.originalName);
    expect(stored!.originalName).not.toContain('john.doe@example.com');

    // Audit evidence.upload tidak menyertakan nama file / originalName / PII.
    const audits = await prisma.auditLog.findMany({
      where: {
        eventId,
        action: 'evidence.upload',
        entityType: 'evidence',
        entityId: evidence.id,
      },
    });
    expect(audits.length).toBe(1);
    const metaStr = JSON.stringify(audits[0].metadata);
    expect(metaStr).not.toContain('originalName');
    expect(metaStr).not.toContain('john.doe@example.com');
    expect(metaStr).not.toContain('1234567890123456');
    expect(metaStr).not.toContain('08123456789');
  });

  it('getEvidenceSignedUrl mengembalikan originalName bersih; audit access tanpa nama file', async () => {
    const { eventId, membershipId, txId } = await seedChairAndDraftTx();

    const originalName = 'laporan jane.doe@example.com 08129876543.pdf';
    const evidence = await uploadEvidence(
      eventId,
      txId,
      membershipId,
      {
        fileKey: 'unused',
        originalName,
        mimeType: 'application/pdf',
        sizeBytes: pdfBuffer().length,
        buffer: pdfBuffer(),
      },
      false
    );

    const urlRes = await getEvidenceSignedUrl(eventId, txId, evidence.id, membershipId, 600);

    // Respons signed-url metadata sudah bersih PII.
    expect(urlRes.evidence.originalName).not.toContain('jane.doe@example.com');
    expect(urlRes.evidence.originalName).not.toContain('08129876543');
    expect(urlRes.evidence.originalName).toContain('EMAIL_DISANDINGKAN');
    expect(urlRes.evidence.originalName.endsWith('.pdf')).toBe(true);
    expect(typeof urlRes.url).toBe('string');
    expect(urlRes.url).toContain('/storage/');

    // Audit evidence.access tidak menyertakan nama file.
    const audits = await prisma.auditLog.findMany({
      where: {
        eventId,
        action: 'evidence.access',
        entityType: 'evidence',
        entityId: evidence.id,
      },
    });
    expect(audits.length).toBe(1);
    const metaStr = JSON.stringify(audits[0].metadata);
    expect(metaStr).not.toContain('originalName');
    expect(metaStr).not.toContain('jane.doe@example.com');
    expect(metaStr).not.toContain('08129876543');
  });
});

// ===========================================================================
// Evidence: list — transaksi harus ada di event diminta (404 cross-event / tidak ada)
// ===========================================================================
describe('GET evidence list — ownership scoped to event', () => {
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

  beforeAll(() => {
    setStorageProviderForTest(fakeStorageProvider);
    files.clear();
  });
  afterAll(() => {
    resetStorageProviderForTest();
    files.clear();
  });

  function pdfBuffer(): Buffer {
    return Buffer.from('%PDF-1.4\n%fake pdf\n%%EOF\n', 'utf8');
  }

  async function seedTx() {
    const agent = await makeAgent('EVENT_CHAIR');
    const { eventId, membershipId } = await makeEventAndMembership(agent.id);
    const r = await createTx(agent.tokenPlain, eventId, {
      type: 'EXPENSE',
      category: 'VENUE',
      description: 'beli alat',
      amount: '500000.00',
    });
    expect(r.status).toBe(201);
    return { agent, eventId, membershipId, txId: r.body.data.id, tokenPlain: agent.tokenPlain };
  }

  async function uploadEvidenceForTx(
    eventId: string,
    txId: string,
    membershipId: string
  ) {
    return uploadEvidence(
      eventId,
      txId,
      membershipId,
      {
        fileKey: 'unused',
        originalName: 'bukti.pdf',
        mimeType: 'application/pdf',
        sizeBytes: pdfBuffer().length,
        buffer: pdfBuffer(),
      },
      false
    );
  }

  it('transaksi tidak ada pada event → 404, bukan []', async () => {
    const { eventId, tokenPlain } = await seedTx();
    const nonexistentTx = '00000000-0000-0000-0000-000000000000';
    const res = await listEvidence(tokenPlain, eventId, nonexistentTx);
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('transaksi milik event lain (lintas-event) → 404, tidak bocorkan keberadaan', async () => {
    const owner = await seedTx();
    const chairB = await makeAgent('EVENT_CHAIR');
    const { eventId: eventB } = await makeEventAndMembership(chairB.id);

    const res = await listEvidence(chairB.tokenPlain, eventB, owner.txId);
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('transaksi ada tetapi belum punya evidence → 200 items []', async () => {
    const { eventId, txId, tokenPlain } = await seedTx();
    const res = await listEvidence(tokenPlain, eventId, txId);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.items).toEqual([]);
  });

  it('transaksi ada dengan evidence → 200 items berisi metadata dan tidak menyertakan fileKey', async () => {
    const { eventId, txId, membershipId, tokenPlain } = await seedTx();
    await uploadEvidenceForTx(eventId, txId, membershipId);
    const res = await listEvidence(tokenPlain, eventId, txId);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.items).toHaveLength(1);
    expect(res.body.data.items[0].transactionId).toBe(txId);
    expect(res.body.data.items[0]).not.toHaveProperty('fileKey');
  });
});
