import { hash } from "@node-rs/argon2";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../src/config/database.js";
import { createApp } from "../src/app.ts";
import { hashToken } from "../src/shared/utils/token.js";
import { ALLOWED_TRANSITIONS } from "../src/modules/finance/finance.service.js";
import { cleanupTestData, testEventIds, testUserIds } from "./finance.helpers.js";
import supertest from "supertest";

// ---------------------------------------------------------------------------
// Konfigurasi isolasi DB & rate-limit.
// ---------------------------------------------------------------------------
// Semua user/sesi/event/membership dibuat via Prisma (0 request ke endpoint
// /register|/login|/create-event), sehingga credentialRateLimiter tidak
// terpakai. CSRF diambil sekali di beforeAll. Endpoint finance dipanggil
// via Supertest hanya untuk skenario yang diuji.
// ---------------------------------------------------------------------------

const app = createApp();
const ORIGIN = "http://localhost:5173";

let sharedCsrf: string;

function email(label: string): string {
  return `fin.${label}.${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
}

function cookieHeader(tokenPlain: string, csrfToken: string): string {
  return `ec_csrf=${csrfToken}; ec_session=${tokenPlain}`;
}

async function makeAgent(_role: "EVENT_CHAIR" | "DIVISION_LEADER" | "MEMBER" = "MEMBER") {
  const e = email("user");
  const passwordHash = await hash("password123");
  const user = await prisma.user.create({ data: { name: "Fin User", email: e, passwordHash } });
  testUserIds.push(user.id);
  const tokenPlain = `tok_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await prisma.session.create({
    data: { userId: user.id, tokenHash: hashToken(tokenPlain), expiresAt, ip: null, userAgent: null },
  });
  return { id: user.id, userId: user.id, email: e, tokenPlain };
}

async function makeEventAndMembership(userId: string) {
  const event = await prisma.event.create({
    data: { name: "Fin Event", slug: `fin-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, createdById: userId },
  });
  testEventIds.push(event.id);
  const membership = await prisma.eventMember.create({
    data: { eventId: event.id, userId, role: "EVENT_CHAIR", parentId: null, title: "Ketua", status: "ACTIVE" },
  });
  return { eventId: event.id, membershipId: membership.id };
}

async function makeMemberInEvent(eventId: string, userId: string, role: "MEMBER" | "DIVISION_LEADER" = "MEMBER", parentId: string | null = null) {
  return prisma.eventMember.create({ data: { eventId, userId, role, parentId, title: role, status: "ACTIVE" } });
}

async function makeMemberInactive(eventId: string, userId: string, parentId: string | null) {
  return prisma.eventMember.create({ data: { eventId, userId, role: "MEMBER", parentId, title: "Member", status: "INACTIVE" } });
}

// ---- Helpers endpoint finance (mengembalikan response supertest) ----
const headers = (tokenPlain: string) => ({
  Origin: ORIGIN,
  Cookie: cookieHeader(tokenPlain, sharedCsrf),
  ...(sharedCsrf ? { "X-CSRF-Token": sharedCsrf } : {}),
});

async function createTx(tokenPlain: string, eventId: string, input: any) {
  return supertest(app)
    .post(`/api/v1/events/${eventId}/transactions`)
    .set(headers(tokenPlain))
    .send(input);
}
async function submitTx(tokenPlain: string, eventId: string, txId: string) {
  return supertest(app)
    .post(`/api/v1/events/${eventId}/transactions/${txId}/submit`)
    .set(headers(tokenPlain))
    .send({});
}
async function approveTx(tokenPlain: string, eventId: string, txId: string) {
  return supertest(app)
    .post(`/api/v1/events/${eventId}/transactions/${txId}/approve`)
    .set(headers(tokenPlain))
    .send({});
}
async function payTx(tokenPlain: string, eventId: string, txId: string) {
  return supertest(app)
    .post(`/api/v1/events/${eventId}/transactions/${txId}/pay`)
    .set(headers(tokenPlain))
    .send({});
}
async function getSummary(tokenPlain: string, eventId: string) {
  return supertest(app)
    .get(`/api/v1/events/${eventId}/finance/summary`)
    .set(headers(tokenPlain));
}
async function listTx(tokenPlain: string, eventId: string, query?: Record<string, string>) {
  const url = new URL(`/api/v1/events/${eventId}/transactions`, "http://localhost");
  if (query) for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  return supertest(app).get(url.pathname + url.search).set(headers(tokenPlain));
}
async function getDetail(tokenPlain: string, eventId: string, txId: string) {
  return supertest(app)
    .get(`/api/v1/events/${eventId}/transactions/${txId}`)
    .set(headers(tokenPlain));
}
async function patchTx(tokenPlain: string, eventId: string, txId: string, body: any) {
  return supertest(app)
    .patch(`/api/v1/events/${eventId}/transactions/${txId}`)
    .set(headers(tokenPlain))
    .send(body);
}

beforeAll(async () => {
  await prisma.$connect();
  // Ambil CSRF sekali (satu request) untuk semua agen.
  const getRes = await supertest(app).get("/api/v1/health").set("Origin", ORIGIN);
  const m = getRes.headers["set-cookie"];
  const arr = Array.isArray(m) ? m : [m];
  const c = arr.find((x) => x.startsWith("ec_csrf="));
  if (!c) throw new Error("ec_csrf tidak tersedia");
  sharedCsrf = c.split(";")[0].split("=")[1];
  await makeAgent("EVENT_CHAIR");
});

afterAll(async () => {
  await cleanupTestData();
  await prisma.$disconnect();
});

// ===========================================================================
// Unit: matriks transisi status (diexport dari finance.service.ts)
// ===========================================================================
describe("matriks transisi status (unit)", () => {
  it.each([
    ["DRAFT", "SUBMITTED"],
    ["DRAFT", "CANCELLED"],
    ["SUBMITTED", "APPROVED"],
    ["SUBMITTED", "REJECTED"],
    ["SUBMITTED", "CANCELLED"],
    ["APPROVED", "PAID"],
    ["APPROVED", "CANCELLED"],
    ["REJECTED", "DRAFT"],
    ["REJECTED", "CANCELLED"],
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
// T6 — IDOR lintas-event
// ===========================================================================
describe("T6 IDOR lintas-event", () => {
  it("detail/PATCH tx event A via event B → 404; non-anggota → 403; tidak bocor", async () => {
    const a = await makeAgent("EVENT_CHAIR");
    const evA = (await makeEventAndMembership(a.id)).eventId;

    const b = await makeAgent("EVENT_CHAIR");
    const evB = (await makeEventAndMembership(b.id)).eventId;

    const c = await makeAgent("MEMBER"); // bukan anggota evA

    const rCreate = await createTx(a.tokenPlain, evA, {
      type: "EXPENSE", category: "VENUE", description: "sewa gedung", amount: "1500000.00",
    });
    expect(rCreate.status).toBe(201);
    const txId = rCreate.body.data.id;

    const rDetailB = await getDetail(b.tokenPlain, evB, txId);
    if (rDetailB.status !== 404) console.error("T6 detail via evB harapan=404 aktual=" + rDetailB.status + " body=" + JSON.stringify(rDetailB.body));
    expect(rDetailB.status).toBe(404);
    expect(rDetailB.body.success).toBe(false);

    const rPatchB = await patchTx(b.tokenPlain, evB, txId, { description: "diubah" });
    if (rPatchB.status !== 404) console.error("T6 patch via evB harapan=404 aktual=" + rPatchB.status + " body=" + JSON.stringify(rPatchB.body));
    expect(rPatchB.status).toBe(404);

    const rDetailOutsider = await getDetail(c.tokenPlain, evA, txId);
    if (rDetailOutsider.status !== 403) console.error("T6 outsider harapan=403 aktual=" + rDetailOutsider.status + " body=" + JSON.stringify(rDetailOutsider.body));
    expect(rDetailOutsider.status).toBe(403);
    expect(rDetailOutsider.body.data).toBeUndefined();
    expect(rDetailB.body.data).toBeUndefined();

    const rDetailOwner = await getDetail(a.tokenPlain, evA, txId);
    expect(rDetailOwner.status).toBe(200);
    expect(rDetailOwner.body.data.id).toBe(txId);
  });
});

// ===========================================================================
// T7 — Akses baca anggota aktif vs INACTIVE
// ===========================================================================
describe("T7 akses baca anggota aktif vs INACTIVE", () => {
  it("Chair/Leader/Member aktif 200; INACTIVE 403", async () => {
    const chair = await makeAgent("EVENT_CHAIR");
    const { eventId, membershipId } = await makeEventAndMembership(chair.id);

    const lead = await makeAgent("DIVISION_LEADER");
    await makeMemberInEvent(eventId, lead.id, "DIVISION_LEADER", membershipId);

    const mem = await makeAgent("MEMBER");
    await makeMemberInEvent(eventId, mem.id, "MEMBER", membershipId);

    const inact = await makeAgent("MEMBER");
    await makeMemberInactive(eventId, inact.id, membershipId);

    const rCreate = await createTx(chair.tokenPlain, eventId, {
      type: "INCOME", category: "SPONSORSHIP", description: "sponsor A", amount: "5000000.00",
    });
    expect(rCreate.status).toBe(201);
    const txId = rCreate.body.data.id;

    for (const ag of [chair, lead, mem]) {
      const s = await getSummary(ag.tokenPlain, eventId);
      if (s.status !== 200) console.error(`T7 ${ag.role} summary harapan=200 aktual=` + s.status + " body=" + JSON.stringify(s.body));
      expect(s.status).toBe(200);
      expect(typeof s.body.data.balance).toBe("string");

      const l = await listTx(ag.tokenPlain, eventId);
      if (l.status !== 200) console.error(`T7 ${ag.role} list harapan=200 aktual=` + l.status + " body=" + JSON.stringify(l.body));
      expect(l.status).toBe(200);
      expect(Array.isArray(l.body.data.items)).toBe(true);

      const d = await getDetail(ag.tokenPlain, eventId, txId);
      if (d.status !== 200) console.error(`T7 ${ag.role} detail harapan=200 aktual=` + d.status + " body=" + JSON.stringify(d.body));
      expect(d.status).toBe(200);
    }

    for (const ep of ["summary", "list", "detail"] as const) {
      let res: any;
      if (ep === "summary") res = await getSummary(inact.tokenPlain, eventId);
      else if (ep === "list") res = await listTx(inact.tokenPlain, eventId);
      else res = await getDetail(inact.tokenPlain, eventId, txId);
      if (res.status !== 403) console.error(`T7 INACTIVE ${ep} harapan=403 aktual=` + res.status + " body=" + JSON.stringify(res.body));
      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
    }
  });
});

// ===========================================================================
// T9 — balance tidak berubah sebelum PAID
// ===========================================================================
describe("T9 balance tidak berubah sebelum PAID", () => {
  it("DRAFT/SUBMITTED/APPROVED amount besar → balance 0; PAID → berubah", async () => {
    const chair = await makeAgent("EVENT_CHAIR");
    const { eventId } = await makeEventAndMembership(chair.id);

    const rCreate = await createTx(chair.tokenPlain, eventId, {
      type: "INCOME", category: "SPONSORSHIP", description: "besar belum dibayar", amount: "100000000.00",
    });
    expect(rCreate.status).toBe(201);
    const txId = rCreate.body.data.id;

    await submitTx(chair.tokenPlain, eventId, txId);
    await approveTx(chair.tokenPlain, eventId, txId);

    const s1 = await getSummary(chair.tokenPlain, eventId);
    expect(s1.status).toBe(200);
    expect(s1.body.data.balance).toBe("0.00");
    expect(s1.body.data.totalIncome).toBe("0.00");
    expect(s1.body.data.totalExpense).toBe("0.00");

    const resPay = await payTx(chair.tokenPlain, eventId, txId);
    if (resPay.status !== 200) console.error("T9 pay harapan=200 aktual=" + resPay.status + " body=" + JSON.stringify(resPay.body));
    expect(resPay.status).toBe(200);

    const s2 = await getSummary(chair.tokenPlain, eventId);
    expect(s2.body.data.balance).toBe("100000000.00");
    expect(s2.body.data.totalIncome).toBe("100000000.00");
    expect(s2.body.data.totalExpense).toBe("0.00");
  });
});

// ===========================================================================
// T10 — pay & ledger
// ===========================================================================
describe("T10 pay & ledger", () => {
  it("INCOME → 1 CREDIT; EXPENSE → 1 DEBIT; pay kedua → 409; saldo tepat", async () => {
    const chair = await makeAgent("EVENT_CHAIR");
    const { eventId } = await makeEventAndMembership(chair.id);

    const rInc = await createTx(chair.tokenPlain, eventId, {
      type: "INCOME", category: "SPONSORSHIP", description: "pemasukan", amount: "1500000.00",
    });
    expect(rInc.status).toBe(201);
    const incId = rInc.body.data.id;
    await submitTx(chair.tokenPlain, eventId, incId);
    await approveTx(chair.tokenPlain, eventId, incId);

    const payInc = await payTx(chair.tokenPlain, eventId, incId);
    if (payInc.status !== 200) console.error("T10 pay income harapan=200 aktual=" + payInc.status + " body=" + JSON.stringify(payInc.body));
    expect(payInc.status).toBe(200);
    expect(payInc.body.data.ledgerEntry.direction).toBe("CREDIT");
    expect(payInc.body.data.ledgerEntry.amount).toBe("1500000.00");
    expect(payInc.body.data.transaction.status).toBe("PAID");

    const sInc = await getSummary(chair.tokenPlain, eventId);
    expect(sInc.body.data.balance).toBe("1500000.00");
    expect(sInc.body.data.totalIncome).toBe("1500000.00");

    const payInc2 = await payTx(chair.tokenPlain, eventId, incId);
    if (payInc2.status !== 409) console.error("T10 pay kedua harapan=409 aktual=" + payInc2.status + " body=" + JSON.stringify(payInc2.body));
    expect(payInc2.status).toBe(409);

    const rExp = await createTx(chair.tokenPlain, eventId, {
      type: "EXPENSE", category: "VENUE", description: "sewa", amount: "400000.00",
    });
    expect(rExp.status).toBe(201);
    const expId = rExp.body.data.id;
    await submitTx(chair.tokenPlain, eventId, expId);
    await approveTx(chair.tokenPlain, eventId, expId);

    const payExp = await payTx(chair.tokenPlain, eventId, expId);
    expect(payExp.status).toBe(200);
    expect(payExp.body.data.ledgerEntry.direction).toBe("DEBIT");

    const sExp = await getSummary(chair.tokenPlain, eventId);
    expect(sExp.body.data.balance).toBe("1100000.00");
    expect(sExp.body.data.totalIncome).toBe("1500000.00");
    expect(sExp.body.data.totalExpense).toBe("400000.00");
  });

  it("pendingCount hanya SUBMITTED", async () => {
    const chair = await makeAgent("EVENT_CHAIR");
    const { eventId } = await makeEventAndMembership(chair.id);

    const mk = async (input: any) => {
      const r = await createTx(chair.tokenPlain, eventId, input);
      expect(r.status).toBe(201);
      return r.body.data.id;
    };
    const s1 = await mk({ type: "EXPENSE", category: "VENUE", description: "a", amount: "100000.00" });
    const s2 = await mk({ type: "EXPENSE", category: "VENUE", description: "b", amount: "100000.00" });
    await submitTx(chair.tokenPlain, eventId, s1);
    await submitTx(chair.tokenPlain, eventId, s2);
    await mk({ type: "EXPENSE", category: "VENUE", description: "c", amount: "100000.00" }); // DRAFT
    const a1 = await mk({ type: "EXPENSE", category: "VENUE", description: "d", amount: "100000.00" });
    await submitTx(chair.tokenPlain, eventId, a1);
    await approveTx(chair.tokenPlain, eventId, a1);
    const p1 = await mk({ type: "EXPENSE", category: "VENUE", description: "e", amount: "100000.00" });
    await submitTx(chair.tokenPlain, eventId, p1);
    await approveTx(chair.tokenPlain, eventId, p1);
    await payTx(chair.tokenPlain, eventId, p1);

    const s = await getSummary(chair.tokenPlain, eventId);
    expect(s.body.data.pendingCount).toBe(2);
  });
});

// ===========================================================================
// T11 — konkurensi pay
// ===========================================================================
describe("T11 konkurensi pay", () => {
  it("6 request pay paralel → 1x 200, 5x 409, 1 ledger, PAID", async () => {
    const chair = await makeAgent("EVENT_CHAIR");
    const { eventId } = await makeEventAndMembership(chair.id);

    const resCreate = await createTx(chair.tokenPlain, eventId, {
      type: "EXPENSE", category: "VENUE", description: "konkuren", amount: "2000000.00",
    });
    expect(resCreate.status).toBe(201);
    const txId = resCreate.body.data.id;
    await submitTx(chair.tokenPlain, eventId, txId);
    await approveTx(chair.tokenPlain, eventId, txId);

    const N = 6;
    const results = await Promise.allSettled(
      Array.from({ length: N }).map(() => payTx(chair.tokenPlain, eventId, txId)),
    );

    let ok = 0;
    let conflict = 0;
    for (const r of results) {
      if (r.status === "fulfilled") {
        if (r.value.status === 200) ok += 1;
        else if (r.value.status === 409) conflict += 1;
        else console.error("T11 status tak terduga=" + r.value.status + " body=" + JSON.stringify(r.value.body));
      } else {
        console.error("T11 rejected=" + String((r as any).reason));
      }
    }
    if (ok !== 1 || conflict !== N - 1) console.error(`T11 ok=${ok} conflict=${conflict} harapan=1/${N - 1}`);
    expect(ok).toBe(1);
    expect(conflict).toBe(N - 1);

    const ledger = await prisma.ledgerEntry.count({ where: { transactionId: txId, reversalOfId: null } });
    if (ledger !== 1) console.error("T11 ledger count harapan=1 aktual=" + ledger);
    expect(ledger).toBe(1);

    const tx = await prisma.financialTransaction.findUnique({ where: { id: txId } });
    expect(tx.status).toBe("PAID");
  });
});
