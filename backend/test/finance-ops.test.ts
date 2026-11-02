import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../src/config/database.js";
import { ALLOWED_TRANSITIONS } from "../src/modules/finance/finance.service.js";
import {
  ensureCsrf, makeAgent, makeEventAndMembership, makeMemberInEvent,
  createTx, submitTx, approveTx, payTx, reverseTx, cancelTx, reopenTx, patchTx,
  getSummary, listTx, getDetail, rejectTxRaw, cleanupTestData,
} from "./finance.helpers.js";

// ---------------------------------------------------------------------------
// Rate-limit aman: user/event/sesi via Prisma; CSRF sekali per berkas (satu
// GET /health). Endpoint finance dipanggil hanya untuk skenario yang diuji.
// ---------------------------------------------------------------------------

beforeAll(async () => {
  await prisma.$connect();
  await ensureCsrf();
});

afterEach(async () => {
  // sessions tidak dipakai kembali antar test; biarkan berlaku sampai afterAll.
});

afterAll(async () => {
  await cleanupTestData();
  await prisma.$disconnect();
});

// ===========================================================================
// Unit: matriks transisi status
// ===========================================================================
describe("matriks transisi status (unit) - ops", () => {
  it.each([
    ["DRAFT", "SUBMITTED"], ["DRAFT", "CANCELLED"],
    ["SUBMITTED", "APPROVED"], ["SUBMITTED", "REJECTED"], ["SUBMITTED", "CANCELLED"],
    ["APPROVED", "PAID"], ["APPROVED", "CANCELLED"],
    ["REJECTED", "DRAFT"], ["REJECTED", "CANCELLED"],
  ])("valid: %s → %s", (from, to) => {
    expect(ALLOWED_TRANSITIONS[from as keyof typeof ALLOWED_TRANSITIONS]).toContain(to);
  });

  it.each([
    ["PAID", "SUBMITTED"], ["PAID", "APPROVED"], ["PAID", "REJECTED"], ["PAID", "CANCELLED"], ["PAID", "DRAFT"],
    ["CANCELLED", "DRAFT"], ["CANCELLED", "SUBMITTED"], ["CANCELLED", "APPROVED"], ["CANCELLED", "REJECTED"], ["CANCELLED", "PAID"], ["CANCELLED", "CANCELLED"],
    ["DRAFT", "APPROVED"], ["DRAFT", "REJECTED"], ["DRAFT", "PAID"],
    ["SUBMITTED", "DRAFT"], ["SUBMITTED", "PAID"],
    ["APPROVED", "SUBMITTED"], ["APPROVED", "REJECTED"],
    ["REJECTED", "APPROVED"], ["REJECTED", "PAID"],
  ])("invalid: %s → %s", (from, to) => {
    expect(ALLOWED_TRANSITIONS[from as keyof typeof ALLOWED_TRANSITIONS]).not.toContain(to);
  });

  it("PAID dan CANCELLED tidak punya transisi keluar", () => {
    expect(ALLOWED_TRANSITIONS.PAID).toEqual([]);
    expect(ALLOWED_TRANSITIONS.CANCELLED).toEqual([]);
  });
});

// ===========================================================================
// T14 — reverse PAID
// ===========================================================================
describe("T14 reverse PAID", () => {
  it("PATCH PAID → 409; reverse → 201; reversal kebalikan; saldo kembali; reverse kedua → 409", async () => {
    const chair = await makeAgent("EVENT_CHAIR");
    const { eventId } = await makeEventAndMembership(chair.id);

    const resCreate = await createTx(chair.tokenPlain, eventId, {
      type: "INCOME", category: "SPONSORSHIP", description: "untuk direversi", amount: "3000000.00",
    });
    expect(resCreate.status).toBe(201);
    const txId = resCreate.body.data.id;
    await submitTx(chair.tokenPlain, eventId, txId);
    await approveTx(chair.tokenPlain, eventId, txId);
    await payTx(chair.tokenPlain, eventId, txId);

    const sBefore = await getSummary(chair.tokenPlain, eventId);
    expect(sBefore.body.data.balance).toBe("3000000.00");

    const resPatch = await patchTx(chair.tokenPlain, eventId, txId, { description: "coba ubah" });
    if (resPatch.status !== 409) console.error("T14 PATCH PAID harapan=409 aktual=" + resPatch.status + " body=" + JSON.stringify(resPatch.body));
    expect(resPatch.status).toBe(409);

    const resRev = await reverseTx(chair.tokenPlain, eventId, txId, "kesalahan input");
    if (resRev.status !== 201) console.error("T14 reverse harapan=201 aktual=" + resRev.status + " body=" + JSON.stringify(resRev.body));
    expect(resRev.status).toBe(201);
    expect(resRev.body.success).toBe(true);
    const rev = resRev.body.data.reversalEntry;
    expect(rev.direction).toBe("DEBIT");
    expect(rev.amount).toBe("3000000.00");
    expect(rev.reversalOfId).toBeDefined();
    expect(typeof rev.reversalOfId).toBe("string");

    const normal = await prisma.ledgerEntry.findFirst({ where: { transactionId: txId, reversalOfId: null } });
    expect(normal).not.toBeNull();
    expect(rev.reversalOfId).toBe(normal.id);

    const sAfter = await getSummary(chair.tokenPlain, eventId);
    expect(sAfter.body.data.balance).toBe("0.00");
    expect(sAfter.body.data.totalIncome).toBe("3000000.00");
    expect(sAfter.body.data.totalExpense).toBe("3000000.00");

    const resRev2 = await reverseTx(chair.tokenPlain, eventId, txId, "lagi");
    if (resRev2.status !== 409) console.error("T14 reverse kedua harapan=409 aktual=" + resRev2.status + " body=" + JSON.stringify(resRev2.body));
    expect(resRev2.status).toBe(409);
  });
});

// ===========================================================================
// API transisi invalid & reopen
// ===========================================================================
describe("API transisi invalid & reopen - ops", () => {
  it("submit APPROVED → 422", async () => {
    const chair = await makeAgent("EVENT_CHAIR");
    const { eventId } = await makeEventAndMembership(chair.id);
    const r = await createTx(chair.tokenPlain, eventId, { type: "EXPENSE", category: "VENUE", description: "x", amount: "100000.00" });
    expect(r.status).toBe(201);
    const txId = r.body.data.id;
    await submitTx(chair.tokenPlain, eventId, txId);
    await approveTx(chair.tokenPlain, eventId, txId);
    const res = await submitTx(chair.tokenPlain, eventId, txId);
    if (res.status !== 422) console.error("submit APPROVED harapan=422 aktual=" + res.status + " body=" + JSON.stringify(res.body));
    expect(res.status).toBe(422);
  });

  it("approve DRAFT → 422", async () => {
    const chair = await makeAgent("EVENT_CHAIR");
    const { eventId } = await makeEventAndMembership(chair.id);
    const r = await createTx(chair.tokenPlain, eventId, { type: "EXPENSE", category: "VENUE", description: "x", amount: "100000.00" });
    expect(r.status).toBe(201);
    const txId = r.body.data.id;
    const res = await approveTx(chair.tokenPlain, eventId, txId);
    if (res.status !== 422) console.error("approve DRAFT harapan=422 aktual=" + res.status + " body=" + JSON.stringify(res.body));
    expect(res.status).toBe(422);
  });

  it("reject tanpa reason → 422", async () => {
    const chair = await makeAgent("EVENT_CHAIR");
    const { eventId } = await makeEventAndMembership(chair.id);
    const r = await createTx(chair.tokenPlain, eventId, { type: "EXPENSE", category: "VENUE", description: "x", amount: "100000.00" });
    expect(r.status).toBe(201);
    const txId = r.body.data.id;
    await submitTx(chair.tokenPlain, eventId, txId);
    const res = await rejectTxRaw(chair.tokenPlain, eventId, txId, {});
    if (res.status !== 422) console.error("reject tanpa reason harapan=422 aktual=" + res.status + " body=" + JSON.stringify(res.body));
    expect(res.status).toBe(422);
  });

  it("reject menyimpan rejectReason yang sudah di-redaksi (PII)", async () => {
    const chair = await makeAgent("EVENT_CHAIR");
    const { eventId } = await makeEventAndMembership(chair.id);
    const r = await createTx(chair.tokenPlain, eventId, { type: "EXPENSE", category: "VENUE", description: "x", amount: "100000.00" });
    expect(r.status).toBe(201);
    const txId = r.body.data.id;
    await submitTx(chair.tokenPlain, eventId, txId);

    const reason = "transfer ke finance@example.com tidak cocok";
    const res = await rejectTxRaw(chair.tokenPlain, eventId, txId, { reason });
    if (res.status !== 200) console.error("reject harapan=200 aktual=" + res.status + " body=" + JSON.stringify(res.body));
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // DB field rejectReason harus sudah di-redaksi, tidak boleh bocor email asli.
    const txAfter = await prisma.financialTransaction.findUnique({ where: { id: txId } });
    expect(txAfter.rejectReason).toBe("transfer ke [EMAIL_DISANDINGKAN] tidak cocok");
    expect(txAfter.rejectReason).not.toContain("finance@example.com");

    // History note juga di-redaksi (non-null).
    const hist = await prisma.transactionHistory.findFirst({ where: { transactionId: txId, toStatus: "REJECTED" } });
    expect(hist.note).toBe("REJECTED: transfer ke [EMAIL_DISANDINGKAN] tidak cocok");
    expect(hist.note).not.toContain("finance@example.com");

    // Detail endpoint juga menyajikan rejectReason yang sudah di-redaksi.
    const det = await getDetail(chair.tokenPlain, eventId, txId);
    expect(det.status).toBe(200);
    expect(det.body.data.rejectReason).toBe("transfer ke [EMAIL_DISANDINGKAN] tidak cocok");
    expect(det.body.data.rejectReason).not.toContain("finance@example.com");
  });

  it("cancel PAID → 422", async () => {
    const chair = await makeAgent("EVENT_CHAIR");
    const { eventId } = await makeEventAndMembership(chair.id);
    const r = await createTx(chair.tokenPlain, eventId, { type: "EXPENSE", category: "VENUE", description: "x", amount: "100000.00" });
    expect(r.status).toBe(201);
    const txId = r.body.data.id;
    await submitTx(chair.tokenPlain, eventId, txId);
    await approveTx(chair.tokenPlain, eventId, txId);
    await payTx(chair.tokenPlain, eventId, txId);
    const res = await cancelTx(chair.tokenPlain, eventId, txId);
    if (res.status !== 422) console.error("cancel PAID harapan=422 aktual=" + res.status + " body=" + JSON.stringify(res.body));
    expect(res.status).toBe(422);
  });

  it("reopen REJECTED oleh pemilik → 200, rejectReason null; lalu PATCH + submit OK", async () => {
    const chair = await makeAgent("EVENT_CHAIR");
    const { eventId } = await makeEventAndMembership(chair.id);
    const r = await createTx(chair.tokenPlain, eventId, { type: "EXPENSE", category: "VENUE", description: "x", amount: "100000.00" });
    expect(r.status).toBe(201);
    const txId = r.body.data.id;
    await submitTx(chair.tokenPlain, eventId, txId);
    await rejectTxRaw(chair.tokenPlain, eventId, txId, { reason: "tidak cocok" });
    const resReopen = await reopenTx(chair.tokenPlain, eventId, txId);
    if (resReopen.status !== 200) console.error("reopen pemilik harapan=200 aktual=" + resReopen.status + " body=" + JSON.stringify(resReopen.body));
    expect(resReopen.status).toBe(200);
    expect(resReopen.body.data.status).toBe("DRAFT");
    const txAfter = await prisma.financialTransaction.findUnique({ where: { id: txId } });
    expect(txAfter.rejectReason).toBeNull();

    const resPatch = await patchTx(chair.tokenPlain, eventId, txId, { description: "direvisi" });
    expect(resPatch.status).toBe(200);
    const resSubmit = await submitTx(chair.tokenPlain, eventId, txId);
    expect(resSubmit.status).toBe(200);
    expect(resSubmit.body.data.status).toBe("SUBMITTED");
  });

  it("reopen REJECTED oleh non-pemilik non-Chair → 403", async () => {
    const chair = await makeAgent("EVENT_CHAIR");
    const { eventId, membershipId } = await makeEventAndMembership(chair.id);
    const memUser = await makeAgent("MEMBER");
    await makeMemberInEvent(eventId, memUser.id, "MEMBER", membershipId);
    const r = await createTx(chair.tokenPlain, eventId, { type: "EXPENSE", category: "VENUE", description: "x", amount: "100000.00" });
    expect(r.status).toBe(201);
    const txId = r.body.data.id;
    await submitTx(chair.tokenPlain, eventId, txId);
    const rejRes = await rejectTxRaw(chair.tokenPlain, eventId, txId, { reason: "tidak cocok" });
    expect(rejRes.status).toBe(200);
    const res = await reopenTx(memUser.tokenPlain, eventId, txId);
    if (res.status !== 403) console.error("reopen non-pemilik harapan=403 aktual=" + res.status + " body=" + JSON.stringify(res.body));
    expect(res.status).toBe(403);
  });
});

// ===========================================================================
// Permission matrix transaksi
// ===========================================================================
describe("Permission matrix transaksi - ops", () => {
  it("Member 403 approve/reject/pay/reverse; Member create DRAFT OK", async () => {
    const chair = await makeAgent("EVENT_CHAIR");
    const { eventId, membershipId } = await makeEventAndMembership(chair.id);
    const memUser = await makeAgent("MEMBER");
    await makeMemberInEvent(eventId, memUser.id, "MEMBER", membershipId);

    const r = await createTx(memUser.tokenPlain, eventId, {
      type: "EXPENSE", category: "VENUE", description: "milik member", amount: "100000.00",
    });
    expect(r.status).toBe(201);
    const txId = r.body.data.id;

    expect(await approveTx(memUser.tokenPlain, eventId, txId)).toMatchObject({ status: 403 });
    const rej = await rejectTxRaw(memUser.tokenPlain, eventId, txId, { reason: "alasan" });
    expect(rej.status).toBe(403);
    expect(await payTx(memUser.tokenPlain, eventId, txId)).toMatchObject({ status: 403 });
    expect(await reverseTx(memUser.tokenPlain, eventId, txId, "alasan")).toMatchObject({ status: 403 });
  });

  it("Leader tidak boleh approve (403)", async () => {
    const chair = await makeAgent("EVENT_CHAIR");
    const { eventId, membershipId } = await makeEventAndMembership(chair.id);
    const leadUser = await makeAgent("DIVISION_LEADER");
    await makeMemberInEvent(eventId, leadUser.id, "DIVISION_LEADER", membershipId);

    const r = await createTx(chair.tokenPlain, eventId, { type: "EXPENSE", category: "VENUE", description: "x", amount: "100000.00" });
    expect(r.status).toBe(201);
    const txId = r.body.data.id;
    await submitTx(chair.tokenPlain, eventId, txId);
    const res = await approveTx(leadUser.tokenPlain, eventId, txId);
    expect(res.status).toBe(403);
  });

  it("non-owner Member submit DRAFT orang lain → 403", async () => {
    const chair = await makeAgent("EVENT_CHAIR");
    const { eventId, membershipId } = await makeEventAndMembership(chair.id);
    const owner = await makeAgent("MEMBER");
    await makeMemberInEvent(eventId, owner.id, "MEMBER", membershipId);
    const other = await makeAgent("MEMBER");
    await makeMemberInEvent(eventId, other.id, "MEMBER", membershipId);

    const r = await createTx(owner.tokenPlain, eventId, { type: "EXPENSE", category: "VENUE", description: "milik owner", amount: "100000.00" });
    expect(r.status).toBe(201);
    const txId = r.body.data.id;
    const res = await submitTx(other.tokenPlain, eventId, txId);
    expect(res.status).toBe(403);
  });

  it("cancel APPROVED hanya Chair (Member owner → 403); cancel DRAFT owner → 200", async () => {
    const chair = await makeAgent("EVENT_CHAIR");
    const { eventId, membershipId } = await makeEventAndMembership(chair.id);
    const owner = await makeAgent("MEMBER");
    await makeMemberInEvent(eventId, owner.id, "MEMBER", membershipId);

    const rDraft = await createTx(owner.tokenPlain, eventId, { type: "EXPENSE", category: "VENUE", description: "draft", amount: "100000.00" });
    expect(rDraft.status).toBe(201);
    const draftId = rDraft.body.data.id;
    const cDraft = await cancelTx(owner.tokenPlain, eventId, draftId);
    expect(cDraft.status).toBe(200);

    const rApp = await createTx(owner.tokenPlain, eventId, { type: "EXPENSE", category: "VENUE", description: "approved", amount: "100000.00" });
    expect(rApp.status).toBe(201);
    const appId = rApp.body.data.id;
    await submitTx(owner.tokenPlain, eventId, appId);
    await approveTx(chair.tokenPlain, eventId, appId);
    const cApp = await cancelTx(owner.tokenPlain, eventId, appId);
    expect(cApp.status).toBe(403);
  });
});

// ===========================================================================
// Validasi input transaksi
// ===========================================================================
describe("Validasi input transaksi - ops", () => {
  it.each([
    ["amount 0", { amount: "0" }],
    ["amount negatif", { amount: "-100" }],
    ["amount 3 desimal", { amount: "100.001" }],
    ["amount terlalu besar (18 digit int)", { amount: "999999999999999999.00" }],
  ])("amount %s → 422", async (_label, input) => {
    const chair = await makeAgent("EVENT_CHAIR");
    const { eventId } = await makeEventAndMembership(chair.id);
    const res = await createTx(chair.tokenPlain, eventId, { type: "EXPENSE", category: "VENUE", description: "x", ...input });
    if (res.status !== 422) console.error(`amount ${_label} harapan=422 aktual=` + res.status + " body=" + JSON.stringify(res.body));
    expect(res.status).toBe(422);
  });

  it("currency non-IDR → 422", async () => {
    const chair = await makeAgent("EVENT_CHAIR");
    const { eventId } = await makeEventAndMembership(chair.id);
    const res = await createTx(chair.tokenPlain, eventId, {
      type: "EXPENSE", category: "VENUE", description: "x", amount: "100000.00", currency: "USD",
    });
    if (res.status !== 422) console.error("currency USD harapan=422 aktual=" + res.status + " body=" + JSON.stringify(res.body));
    expect(res.status).toBe(422);
  });

  it("category tidak cocok type → 422", async () => {
    const chair = await makeAgent("EVENT_CHAIR");
    const { eventId } = await makeEventAndMembership(chair.id);
    const res = await createTx(chair.tokenPlain, eventId, { type: "INCOME", category: "VENUE", description: "x", amount: "100000.00" });
    if (res.status !== 422) console.error("category/type harapan=422 aktual=" + res.status + " body=" + JSON.stringify(res.body));
    expect(res.status).toBe(422);
  });

  it("description kosong → 422", async () => {
    const chair = await makeAgent("EVENT_CHAIR");
    const { eventId } = await makeEventAndMembership(chair.id);
    const res = await createTx(chair.tokenPlain, eventId, { type: "EXPENSE", category: "VENUE", description: "   ", amount: "100000.00" });
    if (res.status !== 422) console.error("description kosong harapan=422 aktual=" + res.status + " body=" + JSON.stringify(res.body));
    expect(res.status).toBe(422);
  });

  it("filter status asing → 422", async () => {
    const chair = await makeAgent("EVENT_CHAIR");
    const { eventId } = await makeEventAndMembership(chair.id);
    const res = await listTx(chair.tokenPlain, eventId, { status: "FOREVER" as any });
    if (res.status !== 422) console.error("filter status asing harapan=422 aktual=" + res.status + " body=" + JSON.stringify(res.body));
    expect(res.status).toBe(422);
  });

  it("filter type asing → 422", async () => {
    const chair = await makeAgent("EVENT_CHAIR");
    const { eventId } = await makeEventAndMembership(chair.id);
    const res = await listTx(chair.tokenPlain, eventId, { type: "INVEST" as any });
    if (res.status !== 422) console.error("filter type asing harapan=422 aktual=" + res.status + " body=" + JSON.stringify(res.body));
    expect(res.status).toBe(422);
  });
});
