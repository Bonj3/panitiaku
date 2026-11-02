// backend/test/evidence-t8-signed-url.test.ts
//
// T8 — Akses bukti transaksi via signed URL (PROJECT §15 skenario T8, §5.C,
// BR-12, BR-13).
//
// Cakupan:
//   1. Tanpa sesi → 401 UNAUTHORIZED
//   2. Non-anggota (sesi valid, bukan member event) → 403 FORBIDDEN
//   3. Anggota INACTIVE → 403 FORBIDDEN
//   4. Anggota ACTIVE (MEMBER biasa) → 200 + signed URL, expiresAt 5–15 menit
//   5. TTL boundary: default 600s (10 m); rentang diterima 300–900s
//   6. Upload berkas >10 MiB → 413
//   7. MIME/signature tidak valid → 422
//   8. Ekstensi tidak cocok dengan MIME aktual → 422
//   9. Storage gagal (fail-closed) → tidak ada URL
//
// Catatan spesifikasi TTL: PROJECT menyatakan signed URL berumur 5–15 menit,
// default 10 menit (600s). evidenceUrlQuerySchema sebelumnya clamp ke [60, 900]
// detik (mengizinkan 60 detik, bertentangan dengan spec batas bawah 5 menit =
// 300s). Diperbaiki ke clamp [300, 900], default 600 (lihat laporan akhir).

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../src/config/database.js';
import { app, ensureCsrf, sharedCsrf, makeAgent, makeEventAndMembership, createTx, cleanupTestData, ORIGIN } from './finance.helpers.js';
import supertest from 'supertest';
import {
  setStorageProviderForTest,
  resetStorageProviderForTest,
} from '../src/modules/storage/s3-storage-provider.js';
import type { StorageProvider } from '../src/modules/storage/storage.provider.js';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MiB (OD-7)
const TOLERANCE_SEC = 5;

function cookieHeader(tokenPlain: string, csrfToken: string): string {
  return `ec_csrf=${csrfToken}; ec_session=${tokenPlain}`;
}

/** Buat user dengan sesi, lalu buat membershipnya pada event (role MEMBER). */
async function makeMemberOnEvent(
  eventId: string,
  parentId: string,
  status: 'ACTIVE' | 'INACTIVE' = 'ACTIVE'
) {
  const agent = await makeAgent('MEMBER');
  await prisma.eventMember.create({
    data: { eventId, userId: agent.id, role: 'MEMBER', parentId, title: 'Member', status },
  });
  return agent;
}

/** Buat DRAFT transaksi sebagai pemilik, lalu unggah bukti sebagai pemilik. */
async function seedMemberWithEvidence() {
  const chair = await makeAgent('EVENT_CHAIR');
  const { eventId, membershipId } = await makeEventAndMembership(chair.id);

  const member = await makeMemberOnEvent(eventId, membershipId, 'ACTIVE');

  const txRes = await createTx(member.tokenPlain, eventId, {
    type: 'EXPENSE',
    category: 'VENUE',
    description: 'beli alat',
    amount: '500000.00',
  });
  if (txRes.status !== 201) throw new Error('create draft gagal: ' + JSON.stringify(txRes.body));
  const txId = txRes.body.data.id;

  const pdf = Buffer.from('%PDF-1.4\n%fake pdf\n%%EOF\n', 'utf8');
  const upRes = await supertest(app)
    .post(`/api/v1/events/${eventId}/transactions/${txId}/evidence`)
    .set('Origin', ORIGIN)
    .set('Cookie', cookieHeader(member.tokenPlain, sharedCsrf))
    .set('X-CSRF-Token', sharedCsrf)
    .attach('file', pdf, 'bukti.pdf')
    .field('isPaymentProof', 'false');
  if (upRes.status !== 201) throw new Error('upload gagal: ' + JSON.stringify(upRes.body));
  const evidenceId = upRes.body.data.id;

  return { chair, eventId, membershipId, member, txId, evidenceId, tokenPlain: member.tokenPlain };
}

function getUrlRequest(tokenPlain: string | undefined, eventId: string, txId: string, evidenceId: string, query?: string) {
  const url = new URL(`/api/v1/events/${eventId}/transactions/${txId}/evidence/${evidenceId}/url`, 'http://localhost');
  if (query) url.search = query;
  let req = supertest(app).get(url.pathname + url.search).set('Origin', ORIGIN);
  if (tokenPlain) req = req.set('Cookie', cookieHeader(tokenPlain, sharedCsrf));
  return req;
}

function expiresInSeconds(expiresAt: string | Date, refMs: number): number {
  return (new Date(expiresAt).getTime() - refMs) / 1000;
}

function pdfBuffer(): Buffer {
  return Buffer.from('%PDF-1.4\n%fake pdf\n%%EOF\n', 'utf8');
}

function textBuffer(): Buffer {
  return Buffer.from('ini bukan berkas media asli, hanya teks sembarang', 'utf8');
}

function oversizedBuffer(): Buffer {
  return Buffer.alloc(MAX_FILE_SIZE + 1, 0x41);
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

beforeAll(async () => {
  await prisma.$connect();
  await ensureCsrf();
  setStorageProviderForTest(fakeStorageProvider);
  files.clear();
});

afterAll(async () => {
  await cleanupTestData();
  resetStorageProviderForTest();
  files.clear();
  await prisma.$disconnect();
});

// ===========================================================================
// T8-A: Otorisasi akses signed URL
// ===========================================================================
describe('GET signed URL — otorisasi (T8)', () => {
  it('tanpa sesi → 401 UNAUTHORIZED', async () => {
    const { eventId, txId, evidenceId } = await seedMemberWithEvidence();
    const res = await getUrlRequest(undefined, eventId, txId, evidenceId);
    if (res.status !== 401)
      throw new Error(`tanpa sesi harapan=401 aktual=${res.status} body=${JSON.stringify(res.body)}`);
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('non-anggota (sesi valid, bukan member event) → 403 FORBIDDEN', async () => {
    const owner = await seedMemberWithEvidence();
    const outsider = await makeAgent('MEMBER'); // sesi valid, tidak ada membership pada event owner
    const res = await getUrlRequest(outsider.tokenPlain, owner.eventId, owner.txId, owner.evidenceId);
    if (res.status !== 403)
      throw new Error(`non-anggota harapan=403 aktual=${res.status} body=${JSON.stringify(res.body)}`);
    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('anggota INACTIVE → 403 FORBIDDEN', async () => {
    const { eventId, membershipId, txId, evidenceId } = await seedMemberWithEvidence();
    const inactive = await makeMemberOnEvent(eventId, membershipId, 'INACTIVE');
    const res = await getUrlRequest(inactive.tokenPlain, eventId, txId, evidenceId);
    if (res.status !== 403)
      throw new Error(`inactive harapan=403 aktual=${res.status} body=${JSON.stringify(res.body)}`);
    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('anggota ACTIVE (MEMBER biasa) → 200 signed URL + expiresAt ≈ 600s (default 10 m)', async () => {
    const { eventId, txId, evidenceId, tokenPlain } = await seedMemberWithEvidence();
    const beforeMs = Date.now();
    const res = await getUrlRequest(tokenPlain, eventId, txId, evidenceId);
if (res.status !== 200)
      throw new Error(`active member harapan=200 aktual=${res.status} body=${JSON.stringify(res.body)}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(typeof res.body.data.url).toBe('string');
    expect(res.body.data.url).toContain('/storage/');
    expect(res.body.data.expiresAt).toBeDefined();
    const diffSec = expiresInSeconds(res.body.data.expiresAt, beforeMs);
    // Default 10 menit = 600 detik, toleransi kecil karena waktu komputasi.
    expect(diffSec).toBeGreaterThanOrEqual(600 - TOLERANCE_SEC);
    expect(diffSec).toBeLessThanOrEqual(600 + TOLERANCE_SEC);
    // Respons tidak pernah menyertakan fileKey.
    expect(res.body.data.evidence).not.toHaveProperty('fileKey');
  });
});

// ===========================================================================
// T8-B: TTL boundary behavior (rentang 300–900 detik, default 600)
// ===========================================================================
describe('GET signed URL — TTL boundary (rentang 300–900 detik, default 600)', () => {
  it('tanpa query ttlSeconds → default 600 detik', async () => {
    const { eventId, txId, evidenceId, tokenPlain } = await seedMemberWithEvidence();
    const beforeMs = Date.now();
    const res = await getUrlRequest(tokenPlain, eventId, txId, evidenceId);
expect(res.status).toBe(200);
    const diffSec = expiresInSeconds(res.body.data.expiresAt, beforeMs);
    expect(diffSec).toBeGreaterThanOrEqual(600 - TOLERANCE_SEC);
    expect(diffSec).toBeLessThanOrEqual(600 + TOLERANCE_SEC);
  });

  it('ttlSeconds=300 (5 menit, batas bawah) → diterima, expiresAt ≈ 300s', async () => {
    const { eventId, txId, evidenceId, tokenPlain } = await seedMemberWithEvidence();
    const beforeMs = Date.now();
    const res = await getUrlRequest(tokenPlain, eventId, txId, evidenceId, 'ttlSeconds=300');
expect(res.status).toBe(200);
    const diffSec = expiresInSeconds(res.body.data.expiresAt, beforeMs);
    expect(diffSec).toBeGreaterThanOrEqual(300 - TOLERANCE_SEC);
    expect(diffSec).toBeLessThanOrEqual(300 + TOLERANCE_SEC);
  });

  it('ttlSeconds=900 (15 menit, batas atas) → diterima, expiresAt ≈ 900s', async () => {
    const { eventId, txId, evidenceId, tokenPlain } = await seedMemberWithEvidence();
    const beforeMs = Date.now();
    const res = await getUrlRequest(tokenPlain, eventId, txId, evidenceId, 'ttlSeconds=900');
expect(res.status).toBe(200);
    const diffSec = expiresInSeconds(res.body.data.expiresAt, beforeMs);
    expect(diffSec).toBeGreaterThanOrEqual(900 - TOLERANCE_SEC);
    expect(diffSec).toBeLessThanOrEqual(900 + TOLERANCE_SEC);
  });

  it('ttlSeconds=60 (1 menit, di bawah 5 m) → tidak diterima sebagai 60; clamp ke 300', async () => {
    const { eventId, txId, evidenceId, tokenPlain } = await seedMemberWithEvidence();
    const beforeMs = Date.now();
    const res = await getUrlRequest(tokenPlain, eventId, txId, evidenceId, 'ttlSeconds=60');
expect(res.status).toBe(200);
    const diffSec = expiresInSeconds(res.body.data.expiresAt, beforeMs);
    // Di-clamp ke batas bawah 300 detik; pasti bukan 60 detik.
    expect(diffSec).toBeGreaterThanOrEqual(300 - TOLERANCE_SEC);
    expect(diffSec).toBeLessThanOrEqual(300 + TOLERANCE_SEC);
    expect(diffSec).toBeGreaterThan(100); // explicitly not 60s
  });

  it('ttlSeconds=9999 (di atas 15 m) → clamp ke 900', async () => {
    const { eventId, txId, evidenceId, tokenPlain } = await seedMemberWithEvidence();
    const beforeMs = Date.now();
    const res = await getUrlRequest(tokenPlain, eventId, txId, evidenceId, 'ttlSeconds=9999');
expect(res.status).toBe(200);
    const diffSec = expiresInSeconds(res.body.data.expiresAt, beforeMs);
    expect(diffSec).toBeGreaterThanOrEqual(900 - TOLERANCE_SEC);
    expect(diffSec).toBeLessThanOrEqual(900 + TOLERANCE_SEC);
  });

  it('ttlSeconds non-angka → 422 UNPROCESSABLE', async () => {
    const { eventId, txId, evidenceId, tokenPlain } = await seedMemberWithEvidence();
    const res = await getUrlRequest(tokenPlain, eventId, txId, evidenceId, 'ttlSeconds=abc');
    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('UNPROCESSABLE');
  });
});

// ===========================================================================
// T8-C: Upload bukti — validasi berkas (multer + validator)
// ===========================================================================
describe('POST upload — validasi berkas (T8)', () => {
  it('berkas >10 MiB → 413', async () => {
    const { eventId, tokenPlain } = await (async () => {
      const chair = await makeAgent('EVENT_CHAIR');
      const { eventId, membershipId } = await makeEventAndMembership(chair.id);
      const member = await makeMemberOnEvent(eventId, membershipId, 'ACTIVE');
      const txRes = await createTx(member.tokenPlain, eventId, {
        type: 'EXPENSE',
        category: 'VENUE',
        description: 'beli alat',
        amount: '500000.00',
      });
      expect(txRes.status).toBe(201);
      return { eventId, tokenPlain: member.tokenPlain, txId: txRes.body.data.id };
    })();
    const res = await supertest(app)
      .post(`/api/v1/events/${eventId}/transactions/00000000-0000-0000-000000000000/evidence`)
      .set('Origin', ORIGIN)
      .set('Cookie', cookieHeader(tokenPlain, sharedCsrf))
      .set('X-CSRF-Token', sharedCsrf)
      .attach('file', oversizedBuffer(), 'besar.pdf');
    // Multer menolak sebelum mencapai controller; tidak ada URL.
    expect(res.status).toBe(413);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('BAD_REQUEST');
  });

  it('MIME/signature tidak valid (bukan berkas whitelist) → 422', async () => {
    const { eventId, tokenPlain, txId } = await (async () => {
      const chair = await makeAgent('EVENT_CHAIR');
      const { eventId, membershipId } = await makeEventAndMembership(chair.id);
      const member = await makeMemberOnEvent(eventId, membershipId, 'ACTIVE');
      const txRes = await createTx(member.tokenPlain, eventId, {
        type: 'EXPENSE',
        category: 'VENUE',
        description: 'beli alat',
        amount: '500000.00',
      });
      expect(txRes.status).toBe(201);
      return { eventId, tokenPlain: member.tokenPlain, txId: txRes.body.data.id };
    })();
    const res = await supertest(app)
      .post(`/api/v1/events/${eventId}/transactions/${txId}/evidence`)
      .set('Origin', ORIGIN)
      .set('Cookie', cookieHeader(tokenPlain, sharedCsrf))
      .set('X-CSRF-Token', sharedCsrf)
      .attach('file', textBuffer(), 'bukti.pdf');
    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('UNPROCESSABLE');
    expect(res.body.error.details.reason).toBe('invalid_mime');
  });

  it('ekstensi tidak cocok dengan MIME aktual (.jpg tetapi isi PDF) → 422', async () => {
    const { eventId, tokenPlain, txId } = await (async () => {
      const chair = await makeAgent('EVENT_CHAIR');
      const { eventId, membershipId } = await makeEventAndMembership(chair.id);
      const member = await makeMemberOnEvent(eventId, membershipId, 'ACTIVE');
      const txRes = await createTx(member.tokenPlain, eventId, {
        type: 'EXPENSE',
        category: 'VENUE',
        description: 'beli alat',
        amount: '500000.00',
      });
      expect(txRes.status).toBe(201);
      return { eventId, tokenPlain: member.tokenPlain, txId: txRes.body.data.id };
    })();
    const res = await supertest(app)
      .post(`/api/v1/events/${eventId}/transactions/${txId}/evidence`)
      .set('Origin', ORIGIN)
      .set('Cookie', cookieHeader(tokenPlain, sharedCsrf))
      .set('X-CSRF-Token', sharedCsrf)
      .attach('file', pdfBuffer(), 'bukti.jpg');
    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('UNPROCESSABLE');
    expect(res.body.error.details.reason).toBe('extension_mime_mismatch');
  });
});

// ===========================================================================
// T8-D: Storage fail-closed — tidak ada URL saat storage gagal
// ===========================================================================
describe('GET signed URL — storage fail-closed (tidak ada URL)', () => {
  let seeded: Awaited<ReturnType<typeof seedMemberWithEvidence>> | null = null;

  const throwingStorage: StorageProvider = {
    async put() {
      throw new Error('storage tidak tersedia');
    },
    async delete() {
      throw new Error('storage tidak tersedia');
    },
    async signedGetUrl() {
      throw new Error('storage tidak tersedia');
    },
    isAvailable(): boolean {
      return false;
    },
  };

  beforeAll(async () => {
    // Siapkan bukti yang benar-benar ada di DB dengan provider normal.
    setStorageProviderForTest(fakeStorageProvider);
    files.clear();
    seeded = await seedMemberWithEvidence();
  });

  afterAll(async () => {
    resetStorageProviderForTest();
    files.clear();
    seeded = null;
  });

  it('storage signedGetUrl gagal → response error, tidak ada url dalam body', async () => {
    expect(seeded).not.toBeNull();
    const { tokenPlain, eventId, txId, evidenceId } = seeded!;
    setStorageProviderForTest(throwingStorage);
    try {
      const res = await getUrlRequest(tokenPlain, eventId, txId, evidenceId);
      // Fail-closed: tidak boleh mengembalikan URL (status bukan 2xx).
      expect(res.status).not.toBe(200);
      expect(res.body.success).toBe(false);
      expect(res.body.data).toBeUndefined();
      expect(res.body.data?.url).toBeUndefined();
      expect(res.body.data?.expiresAt).toBeUndefined();
      // Envelope error menyertakan kode error (INTERNAL karena error generik
      // bukan AppError) namun tidak pernah menyertakan url.
      expect(res.body.error.code).toBe('INTERNAL');
    } finally {
      resetStorageProviderForTest();
      setStorageProviderForTest(fakeStorageProvider);
    }
  });
});
