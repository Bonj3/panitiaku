import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ensureCsrf,
  makeAgent,
  makeEventAndMembership,
  createTx,
  getSummary,
  listTx,
  cleanupTestData,
} from './finance.helpers.js';

// ---------------------------------------------------------------------------
// Reviewer Phase 5: tambahan test IDOR untuk list/summary (PROJECT §15 T6,
// README "Reviewer Phase 5 meminta tambahan test IDOR untuk list/summary").
//
// eventMembership memvalidasi keanggotaan AKTIF pada event yang diminta
// (BR-01). Anggota event A TIDAK boleh membaca finance event B (403), dan
// tidak boleh menebak keberadaan finance event B melalui daftar/ringkasan.
// ---------------------------------------------------------------------------

beforeAll(async () => {
  await ensureCsrf();
});

afterAll(async () => {
  await cleanupTestData();
});

describe('IDOR finance list & summary lintas-event', () => {
  it('anggota event A tidak dapat melihat summary/event B → 403; owner event B → 200', async () => {
    // Chair A (anggota aktif event lain, bukan event B).
    const chairA = await makeAgent('EVENT_CHAIR');
    await makeEventAndMembership(chairA.id);

    // Event B + chair B (anggota aktif event B, beda user).
    const chairB = await makeAgent('EVENT_CHAIR');
    const evB = (await makeEventAndMembership(chairB.id)).eventId;

    // Buat satu transaksi di event B (agar list non-kosong).
    const rCreateB = await createTx(chairB.tokenPlain, evB, {
      type: 'EXPENSE',
      category: 'VENUE',
      description: 'sewa gedung B',
      amount: '2000000.00',
    });
    expect(rCreateB.status).toBe(201);
    const txIdB = rCreateB.body.data.id;

    // --- chairA (bukan anggota event B) mencoba akses summary event B → 403 ---
    const summaryA = await getSummary(chairA.tokenPlain, evB);
    if (summaryA.status !== 403) {
      console.error(
        'IDOR-list-summary GAGAL endpoint=GET /events/:evB/finance/summary (lintas-event) harapan=403 aktual=' +
          summaryA.status +
          ' body=' +
          JSON.stringify(summaryA.body),
      );
    }
    expect(summaryA.status).toBe(403);
    expect(summaryA.body.success).toBe(false);
    expect(summaryA.body.error.code).toBe('FORBIDDEN');

    // --- chairA mencoba akses list transaksi event B → 403 ---
    const listA = await listTx(chairA.tokenPlain, evB);
    if (listA.status !== 403) {
      console.error(
        'IDOR-list-summary GAGAL endpoint=GET /events/:evB/transactions (lintas-event) harapan=403 aktual=' +
          listA.status +
          ' body=' +
          JSON.stringify(listA.body),
      );
    }
    expect(listA.status).toBe(403);
    expect(listA.body.success).toBe(false);
    expect(listA.body.error.code).toBe('FORBIDDEN');

    // --- owner event B (chairB) dapat melihat summary + list → 200 ---
    const summaryB = await getSummary(chairB.tokenPlain, evB);
    if (summaryB.status !== 200) {
      console.error(
        'IDOR-list-summary GAGAL endpoint=GET /events/:evB/finance/summary (owner) harapan=200 aktual=' +
          summaryB.status +
          ' body=' +
          JSON.stringify(summaryB.body),
      );
    }
    expect(summaryB.status).toBe(200);
    expect(summaryB.body.success).toBe(true);
    expect(typeof summaryB.body.data.balance).toBe('string');

    const listB = await listTx(chairB.tokenPlain, evB);
    if (listB.status !== 200) {
      console.error(
        'IDOR-list-summary GAGAL endpoint=GET /events/:evB/transactions (owner) harapan=200 aktual=' +
          listB.status +
          ' body=' +
          JSON.stringify(listB.body),
      );
    }
    expect(listB.status).toBe(200);
    expect(listB.body.success).toBe(true);
    expect(Array.isArray(listB.body.data.items)).toBe(true);
    // Transaksi buatan chairB harus muncul di list miliknya.
    expect(listB.body.data.items.some((i: { id: string }) => i.id === txIdB)).toBe(true);
  });

  it('user tidak ada membership sama sekali pada event B → 403 summary dan list', async () => {
    const chairB = await makeAgent('EVENT_CHAIR');
    const evB = (await makeEventAndMembership(chairB.id)).eventId;

    // User lain yang bukan anggota event B sama sekali.
    const outsider = await makeAgent('MEMBER');

    const summaryOutsider = await getSummary(outsider.tokenPlain, evB);
    if (summaryOutsider.status !== 403) {
      console.error(
        'IDOR-list-summary GAGAL endpoint=GET /events/:evB/finance/summary (outsider) harapan=403 aktual=' +
          summaryOutsider.status +
          ' body=' +
          JSON.stringify(summaryOutsider.body),
      );
    }
    expect(summaryOutsider.status).toBe(403);
    expect(summaryOutsider.body.error.code).toBe('FORBIDDEN');

    const listOutsider = await listTx(outsider.tokenPlain, evB);
    if (listOutsider.status !== 403) {
      console.error(
        'IDOR-list-summary GAGAL endpoint=GET /events/:evB/transactions (outsider) harapan=403 aktual=' +
          listOutsider.status +
          ' body=' +
          JSON.stringify(listOutsider.body),
      );
    }
    expect(listOutsider.status).toBe(403);
    expect(listOutsider.body.error.code).toBe('FORBIDDEN');
  });

  it('eventId bukan UUID / tidak ada → 404 (tidak bocorkan keberadaan event)', async () => {
    const chairA = await makeAgent('EVENT_CHAIR');
    await makeEventAndMembership(chairA.id);

    const notUuid = await getSummary(chairA.tokenPlain, 'bukan-uuid');
    if (notUuid.status !== 404) {
      console.error(
        'IDOR-list-summary GAGAL endpoint=GET /events/:evB/finance/summary (bukan UUID) harapan=404 aktual=' +
          notUuid.status +
          ' body=' +
          JSON.stringify(notUuid.body),
      );
    }
    expect(notUuid.status).toBe(404);
    expect(notUuid.body.error.code).toBe('NOT_FOUND');

    const notExist = await listTx(
      chairA.tokenPlain,
      '00000000-0000-0000-000000000000',
    );
    if (notExist.status !== 404) {
      console.error(
        'IDOR-list-summary GAGAL endpoint=GET /events/:evB/transactions (tidak ada) harapan=404 aktual=' +
          notExist.status +
          ' body=' +
          JSON.stringify(notExist.body),
      );
    }
    expect(notExist.status).toBe(404);
    expect(notExist.body.error.code).toBe('NOT_FOUND');
  });
});
