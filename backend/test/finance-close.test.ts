import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../src/config/database.js";
import {
  ensureCsrf, makeAgent, makeEventAndMembership, createTx, submitTx, approveTx,
  payTx, cancelTx, rejectTxRaw, closeEventApi, cleanupTestData,
} from "./finance.helpers.js";

// ---------------------------------------------------------------------------
// Rate-limit aman: user/event/sesi via Prisma; CSRF sekali per berkas (satu
// GET /health). Endpoint finance dipanggil hanya untuk skenario BR-15.
// ---------------------------------------------------------------------------

beforeAll(async () => {
  await prisma.$connect();
  await ensureCsrf();
});

afterAll(async () => {
  await cleanupTestData();
  await prisma.$disconnect();
});

// ===========================================================================
// BR-15 close-event
// ===========================================================================
describe("BR-15 close-event", () => {
  it("close oleh Chair → cancelledCount=3; PAID tetap + ledger utuh; close kedua 409; pasca-close 409/422", async () => {
    const chair = await makeAgent("EVENT_CHAIR");
    const { eventId } = await makeEventAndMembership(chair.id);

    const rDraft = await createTx(chair.tokenPlain, eventId, { type: "EXPENSE", category: "VENUE", description: "draft", amount: "100000.00" });
    expect(rDraft.status).toBe(201);
    const draftId = rDraft.body.data.id;

    const rSub = await createTx(chair.tokenPlain, eventId, { type: "EXPENSE", category: "VENUE", description: "submitted", amount: "200000.00" });
    expect(rSub.status).toBe(201);
    const subId = rSub.body.data.id;
    await submitTx(chair.tokenPlain, eventId, subId);

    const rApp = await createTx(chair.tokenPlain, eventId, { type: "INCOME", category: "SPONSORSHIP", description: "approved", amount: "300000.00" });
    expect(rApp.status).toBe(201);
    const appId = rApp.body.data.id;
    await submitTx(chair.tokenPlain, eventId, appId);
    await approveTx(chair.tokenPlain, eventId, appId);

    const rPaid = await createTx(chair.tokenPlain, eventId, { type: "EXPENSE", category: "VENUE", description: "paid", amount: "400000.00" });
    expect(rPaid.status).toBe(201);
    const paidId = rPaid.body.data.id;
    await submitTx(chair.tokenPlain, eventId, paidId);
    await approveTx(chair.tokenPlain, eventId, paidId);
    await payTx(chair.tokenPlain, eventId, paidId);
    const ledgerBefore = await prisma.ledgerEntry.count({ where: { transactionId: paidId } });

    const rRej = await createTx(chair.tokenPlain, eventId, { type: "EXPENSE", category: "VENUE", description: "rejected", amount: "500000.00" });
    expect(rRej.status).toBe(201);
    const rejId = rRej.body.data.id;
    await submitTx(chair.tokenPlain, eventId, rejId);
    await rejectTxRaw(chair.tokenPlain, eventId, rejId, { reason: "alasan" });

    const rCan = await createTx(chair.tokenPlain, eventId, { type: "EXPENSE", category: "VENUE", description: "cancelled", amount: "600000.00" });
    expect(rCan.status).toBe(201);
    const canId = rCan.body.data.id;
    await submitTx(chair.tokenPlain, eventId, canId);
    await cancelTx(chair.tokenPlain, eventId, canId);

    const resClose = await closeEventApi(chair.tokenPlain, eventId);
    if (resClose.status !== 200) console.error("BR-15 close harapan=200 aktual=" + resClose.status + " body=" + JSON.stringify(resClose.body));
    expect(resClose.status).toBe(200);
    expect(resClose.body.success).toBe(true);
    expect(resClose.body.data.cancelledCount).toBe(3);

    for (const id of [draftId, subId, appId]) {
      const t = await prisma.financialTransaction.findUnique({ where: { id } });
      expect(t.status).toBe("CANCELLED");
    }
    for (const id of [draftId, subId, appId]) {
      const hist = await prisma.transactionHistory.findFirst({ where: { transactionId: id, note: "EVENT_CLOSED" } });
      expect(hist).not.toBeNull();
    }

    const tPaid = await prisma.financialTransaction.findUnique({ where: { id: paidId } });
    expect(tPaid.status).toBe("PAID");
    const ledgerAfter = await prisma.ledgerEntry.count({ where: { transactionId: paidId } });
    expect(ledgerAfter).toBe(ledgerBefore);

    const tRej = await prisma.financialTransaction.findUnique({ where: { id: rejId } });
    expect(tRej.status).toBe("REJECTED");
    const tCan = await prisma.financialTransaction.findUnique({ where: { id: canId } });
    expect(tCan.status).toBe("CANCELLED");

    const resClose2 = await closeEventApi(chair.tokenPlain, eventId);
    if (resClose2.status !== 409) console.error("BR-15 close kedua harapan=409 aktual=" + resClose2.status + " body=" + JSON.stringify(resClose2.body));
    expect(resClose2.status).toBe(409);

    const resNew = await createTx(chair.tokenPlain, eventId, { type: "EXPENSE", category: "VENUE", description: "baru pasca close", amount: "100000.00" });
    if (resNew.status !== 409) console.error("BR-15 post pasca close harapan=409 aktual=" + resNew.status + " body=" + JSON.stringify(resNew.body));
    expect(resNew.status).toBe(409);

    // Event sudah CLOSED → requireEventOpen dilempar dulu (409), sebelum
    // assertTransition transaksi CANCELLED (422). Konsisten BR-14.
    const resAppCan = await approveTx(chair.tokenPlain, eventId, draftId);
    if (resAppCan.status !== 409) console.error("BR-15 approve CANCELLED (event closed) harapan=409 aktual=" + resAppCan.status + " body=" + JSON.stringify(resAppCan.body));
    expect(resAppCan.status).toBe(409);
    const resPayCan = await payTx(chair.tokenPlain, eventId, draftId);
    if (resPayCan.status !== 409) console.error("BR-15 pay CANCELLED (event closed) harapan=409 aktual=" + resPayCan.status + " body=" + JSON.stringify(resPayCan.body));
    expect(resPayCan.status).toBe(409);
  });
});
