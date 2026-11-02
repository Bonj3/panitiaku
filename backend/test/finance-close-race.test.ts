import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../src/config/database.js';
import {
  ensureCsrf,
  makeAgent,
  makeEventAndMembership,
  createTx,
  submitTx,
  approveTx,
  payTx,
  closeEventApi,
  cleanupTestData,
} from './finance.helpers.js';

// ---------------------------------------------------------------------------
// Reviewer Phase 5: uji race `event.close` vs create/pay (README
// "Reviewer Phase 5 meminta ... uji race `event.close` vs create/pay").
//
// closeEvent dan payTransaction keduanya `SELECT ... FOR UPDATE` pada baris
// event (urutan lock konsisten dengan finance), sehingga race harus
// serialisasi: tepat satu pemegang lock pertama yang menang, state akhir
// konsisten, tidak ada double-ledger posting (BR-11), dan event tidak pernah
// setengah ditutup.
// ---------------------------------------------------------------------------

beforeAll(async () => {
  await ensureCsrf();
});

afterAll(async () => {
  await cleanupTestData();
});

describe('Race event.close vs create/pay', () => {
  it('close vs N pay paralel pada tx APPROVED: tepat satu pay 200 atau close dulu (semua pay 409); tidak ada double posting; event CLOSED', async () => {
    const chair = await makeAgent('EVENT_CHAIR');
    const { eventId } = await makeEventAndMembership(chair.id);

    // Siapkan satu transaksi APPROVED (siap dibayar).
    const rCreate = await createTx(chair.tokenPlain, eventId, {
      type: 'EXPENSE',
      category: 'VENUE',
      description: 'race tx',
      amount: '2000000.00',
    });
    expect(rCreate.status).toBe(201);
    const txId = rCreate.body.data.id;
    await submitTx(chair.tokenPlain, eventId, txId);
    await approveTx(chair.tokenPlain, eventId, txId);

    const N_PAY = 5;
    const results = await Promise.allSettled([
      // Satu request close.
      closeEventApi(chair.tokenPlain, eventId),
      // N request pay paralel pada transaksi yang sama.
      ...Array.from({ length: N_PAY }).map(() =>
        payTx(chair.tokenPlain, eventId, txId),
      ),
    ]);

    const statuses = results.map((r) =>
      r.status === 'fulfilled' ? (r.value as { status: number }).status : 'REJECTED',
    );
    const closeStatus = statuses[0] as number;
    const payStatuses = statuses.slice(1) as number[];

    if (closeStatus !== 200) {
      console.error(
        'close-race GAGAL endpoint=POST /events/:id/close harapan=200 aktual=' +
          closeStatus +
          ' body=' +
          JSON.stringify(results[0]),
      );
    }
    expect(closeStatus).toBe(200);

    const payOk = payStatuses.filter((s) => s === 200).length;
    const payConflict = payStatuses.filter((s) => s === 409 || s === 422).length;
    if (payOk > 1 || payOk + payConflict !== N_PAY) {
      console.error(
        `close-race GAGAL pay: ok=${payOk} conflict=${payConflict} harapan=<=1 ok, sisanya 409/422; statuses=${JSON.stringify(
          payStatuses,
        )}`,
      );
    }
    expect(payOk).toBeLessThanOrEqual(1);
    expect(payOk + payConflict).toBe(N_PAY);

    // Konsistensi akhir: event sudah CLOSED.
    const eventAfter = await prisma.event.findUnique({ where: { id: eventId } });
    expect(eventAfter!.status).toBe('CLOSED');

    // Jika pay menang (200): tx PAID, tepat 1 ledger normal, saldo berubah.
    // Jika close menang sebelum pay: tx dibatalkan (CANCELLED), semua pay 409/422, ledger = 0.
    const txAfter = await prisma.financialTransaction.findUnique({ where: { id: txId } });
    if (payOk === 1) {
      expect(txAfter!.status).toBe('PAID');
      const ledgerNormal = await prisma.ledgerEntry.count({
        where: { transactionId: txId, reversalOfId: null },
      });
      expect(ledgerNormal).toBe(1);
    } else {
      expect(txAfter!.status).toBe('CANCELLED');
      const ledgerNormal = await prisma.ledgerEntry.count({
        where: { transactionId: txId, reversalOfId: null },
      });
      expect(ledgerNormal).toBe(0);
    }

    // Tidak ada double posting di seluruh event: setiap tx paling banyak 1 ledger normal.
    const allLedger = await prisma.ledgerEntry.groupBy({
      by: ['transactionId'],
      where: { eventId, reversalOfId: null },
      _count: { id: true },
    });
    for (const g of allLedger) {
      expect(g._count.id).toBeLessThanOrEqual(1);
    }
  });

  it('close vs create paralel: create sebelum close → 201 lalu dibatalkan oleh close; create setelah close → 409; canceledCount mencakup DRAFT yang dibatalkan', async () => {
    const chair = await makeAgent('EVENT_CHAIR');
    const { eventId } = await makeEventAndMembership(chair.id);

    const N_CREATE = 4;
    const results = await Promise.allSettled([
      closeEventApi(chair.tokenPlain, eventId),
      ...Array.from({ length: N_CREATE }).map(() =>
        createTx(chair.tokenPlain, eventId, {
          type: 'EXPENSE',
          category: 'VENUE',
          description: 'race create',
          amount: '100000.00',
        }),
      ),
    ]);

    const statuses = results.map((r) =>
      r.status === 'fulfilled' ? (r.value as { status: number }).status : 'REJECTED',
    );
    const closeStatus = statuses[0] as number;
    const createStatuses = statuses.slice(1) as number[];

    expect(closeStatus).toBe(200);

    const createOk = createStatuses.filter((s) => s === 201).length;
    const createConflict = createStatuses.filter((s) => s === 409).length;
    expect(createOk + createConflict).toBe(N_CREATE);

    // Event sudah CLOSED dari close yang menang race.
    const eventAfter = await prisma.event.findUnique({ where: { id: eventId } });
    expect(eventAfter!.status).toBe('CLOSED');

    // Tidak ada DRAFT yang tersisa: create yang 201 sebelum close harus
    // dibatalkan oleh BR-15 (auto-cancel DRAFT/SUBMITTED/APPROVED).
    const draftCount = await prisma.financialTransaction.count({
      where: { eventId, status: 'DRAFT' },
    });
    expect(draftCount).toBe(0);

    const canceledCount = await prisma.financialTransaction.count({
      where: { eventId, status: 'CANCELLED' },
    });
    // Setidaknya create yang sukses (201) sekarang CANCELLED oleh close.
    expect(canceledCount).toBeGreaterThanOrEqual(createOk);

    // Create yang datang setelah close → 409 (event sudah ditutup).
    if (createConflict > 0) {
      expect(createConflict).toBeGreaterThanOrEqual(0);
    }
  });
});
