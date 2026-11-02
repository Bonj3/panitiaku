import { hash } from "@node-rs/argon2";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../src/config/database.js";
import { createApp } from "../src/app.ts";
import { hashToken } from "../src/shared/utils/token.js";
import supertest from "supertest";

// ---------------------------------------------------------------------------
// Coverage-gap tests for uncovered finance.service.ts branches:
//   - createTransaction category mismatch (422)
//   - reverseTransaction: not found (404), not PAID (409), no ledger (409)
//   - reverseTransaction P2002 double-reversal race (409)
// ---------------------------------------------------------------------------

const app = createApp();
const ORIGIN = "http://localhost:5173";

const testUserIds: string[] = [];
const testEventIds: string[] = [];

function email(label: string): string {
  return `fg.${label}.${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
}

function cookieHeader(tokenPlain: string, csrfToken: string): string {
  return `ec_csrf=${csrfToken}; ec_session=${tokenPlain}`;
}

let sharedCsrf: string;

async function createUserAndSession() {
  const e = email("user");
  const passwordHash = await hash("password123");
  const user = await prisma.user.create({ data: { name: "FG User", email: e, passwordHash } });
  testUserIds.push(user.id);

  const tokenPlain = `tok_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await prisma.session.create({
    data: { userId: user.id, tokenHash: hashToken(tokenPlain), expiresAt, ip: null, userAgent: null },
  });

  const getRes = await supertest(app).get("/api/v1/health").set("Origin", ORIGIN);
  const m = getRes.headers["set-cookie"];
  const arr = Array.isArray(m) ? m : [m];
  const c = arr.find((x) => x.startsWith("ec_csrf="));
  if (!c) throw new Error("ec_csrf tidak tersedia");
  const csrfToken = c.split(";")[0].split("=")[1];

  return { id: user.id, email: e, tokenPlain, csrfToken };
}

async function createEventAndChair(userId: string) {
  const event = await prisma.event.create({
    data: { name: "FG Event", slug: `fg-${Date.now()}`, createdById: userId },
  });
  testEventIds.push(event.id);

  const membership = await prisma.eventMember.create({
    data: { eventId: event.id, userId, role: "EVENT_CHAIR", parentId: null, title: "Ketua", status: "ACTIVE" },
  });
  return { eventId: event.id, chairMemberId: membership.id };
}

function headers(tokenPlain: string) {
  return {
    Origin: ORIGIN,
    Cookie: cookieHeader(tokenPlain, sharedCsrf),
    "X-CSRF-Token": sharedCsrf,
  };
}

async function createTx(tokenPlain: string, eventId: string, input: any) {
  return supertest(app).post(`/api/v1/events/${eventId}/transactions`).set(headers(tokenPlain)).send(input);
}
async function submitTx(tokenPlain: string, eventId: string, txId: string) {
  return supertest(app).post(`/api/v1/events/${eventId}/transactions/${txId}/submit`).set(headers(tokenPlain)).send({});
}
async function approveTx(tokenPlain: string, eventId: string, txId: string) {
  return supertest(app).post(`/api/v1/events/${eventId}/transactions/${txId}/approve`).set(headers(tokenPlain)).send({});
}
async function payTx(tokenPlain: string, eventId: string, txId: string) {
  return supertest(app).post(`/api/v1/events/${eventId}/transactions/${txId}/pay`).set(headers(tokenPlain)).send({});
}
async function reverseTx(tokenPlain: string, eventId: string, txId: string, reason: string) {
  return supertest(app).post(`/api/v1/events/${eventId}/transactions/${txId}/reverse`).set(headers(tokenPlain)).send({ reason });
}

beforeAll(async () => {
  await prisma.$connect();
  const getRes = await supertest(app).get("/api/v1/health").set("Origin", ORIGIN);
  const m = getRes.headers["set-cookie"];
  const arr = Array.isArray(m) ? m : [m];
  const c = arr.find((x) => x.startsWith("ec_csrf="));
  if (!c) throw new Error("ec_csrf tidak tersedia");
  sharedCsrf = c.split(";")[0].split("=")[1];
});

afterAll(async () => {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL app.allow_ledger_delete = 'on'`);
    await tx.$executeRawUnsafe(
      `DELETE FROM ledger_entries WHERE reversal_of IS NOT NULL AND event_id IN (SELECT id FROM events WHERE slug LIKE 'fg-%')`,
    );
    await tx.$executeRawUnsafe(
      `DELETE FROM ledger_entries WHERE event_id IN (SELECT id FROM events WHERE slug LIKE 'fg-%')`,
    );
    await tx.$executeRawUnsafe(
      `DELETE FROM audit_logs WHERE event_id IN (SELECT id FROM events WHERE slug LIKE 'fg-%')`,
    );
    await tx.$executeRawUnsafe(
      `DELETE FROM transaction_history WHERE transaction_id IN (SELECT id FROM financial_transactions WHERE event_id IN (SELECT id FROM events WHERE slug LIKE 'fg-%'))`,
    );
    await tx.$executeRawUnsafe(
      `DELETE FROM financial_transactions WHERE event_id IN (SELECT id FROM events WHERE slug LIKE 'fg-%')`,
    );
    await tx.$executeRawUnsafe(
      `DELETE FROM event_members WHERE event_id IN (SELECT id FROM events WHERE slug LIKE 'fg-%')`,
    );
    await tx.$executeRawUnsafe(`DELETE FROM events WHERE slug LIKE 'fg-%'`);
    await tx.$executeRawUnsafe(`DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'fg.%')`);
    await tx.$executeRawUnsafe(`DELETE FROM users WHERE email LIKE 'fg.%'`);
  });
  await prisma.$disconnect();
});

// ============================================================================
// Finance gap: createTransaction category mismatch → 422
// ============================================================================
describe("Finance coverage gap: createTransaction category mismatch", () => {
  it("INCOME dengan kategori EXPENSE (VENUE) → 422 UNPROCESSABLE", async () => {
    const chair = await createUserAndSession();
    const { eventId } = await createEventAndChair(chair.id);

    const res = await createTx(chair.tokenPlain, eventId, {
      type: "INCOME",
      category: "VENUE", // kategori EXPENSE, bukan INCOME
      description: "kategori salah",
      amount: "100000.00",
    });
    if (res.status !== 422) {
      console.error(
        "FG-GAP1 endpoint=POST /transactions (category mismatch) harapan=422 aktual=" +
          res.status +
          " body=" +
          JSON.stringify(res.body),
      );
    }
    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe("UNPROCESSABLE");
  });

  it("EXPENSE dengan kategori INCOME (SPONSORSHIP) → 422 UNPROCESSABLE", async () => {
    const chair = await createUserAndSession();
    const { eventId } = await createEventAndChair(chair.id);

    const res = await createTx(chair.tokenPlain, eventId, {
      type: "EXPENSE",
      category: "SPONSORSHIP", // kategori INCOME, bukan EXPENSE
      description: "kategori salah",
      amount: "100000.00",
    });
    if (res.status !== 422) {
      console.error(
        "FG-GAP2 endpoint=POST /transactions (category mismatch) harapan=422 aktual=" +
          res.status +
          " body=" +
          JSON.stringify(res.body),
      );
    }
    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe("UNPROCESSABLE");
  });
});

// ============================================================================
// Finance gap: reverseTransaction — not found (404), not PAID (409), no ledger (409)
// ============================================================================
describe("Finance coverage gap: reverseTransaction error paths", () => {
  it("reverse transaksi tidak ada → 404 NOT_FOUND", async () => {
    const chair = await createUserAndSession();
    const { eventId } = await createEventAndChair(chair.id);

    const fakeTxId = "00000000-0000-0000-0000-000000000000";
    const res = await reverseTx(chair.tokenPlain, eventId, fakeTxId, "tidak ada");
    if (res.status !== 404) {
      console.error(
        "FG-GAP3 endpoint=POST /transactions/:txId/reverse (not found) harapan=404 aktual=" +
          res.status +
          " body=" +
          JSON.stringify(res.body),
      );
    }
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });

  it("reverse transaksi APPROVED (belum PAID) → 409 CONFLICT", async () => {
    const chair = await createUserAndSession();
    const { eventId } = await createEventAndChair(chair.id);

    const rCreate = await createTx(chair.tokenPlain, eventId, {
      type: "INCOME", category: "SPONSORSHIP", description: "approved tapi belum bayar", amount: "500000.00",
    });
    expect(rCreate.status).toBe(201);
    const txId = rCreate.body.data.id;
    await submitTx(chair.tokenPlain, eventId, txId);
    await approveTx(chair.tokenPlain, eventId, txId);

    const res = await reverseTx(chair.tokenPlain, eventId, txId, "coba reverse approved");
    if (res.status !== 409) {
      console.error(
        "FG-GAP4 endpoint=POST /transactions/:txId/reverse (not PAID) harapan=409 aktual=" +
          res.status +
          " body=" +
          JSON.stringify(res.body),
      );
    }
    expect(res.status).toBe(409);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe("CONFLICT");
  });

  it("reverse transaksi PAID tanpa ledger posting normal → 409 CONFLICT", async () => {
    const chair = await createUserAndSession();
    const { eventId } = await createEventAndChair(chair.id);

    const rCreate = await createTx(chair.tokenPlain, eventId, {
      type: "INCOME", category: "SPONSORSHIP", description: "paid tapi ledger dihapus", amount: "700000.00",
    });
    expect(rCreate.status).toBe(201);
    const txId = rCreate.body.data.id;
    await submitTx(chair.tokenPlain, eventId, txId);
    await approveTx(chair.tokenPlain, eventId, txId);
    await payTx(chair.tokenPlain, eventId, txId);

    // Hapus ledger entry normal secara manual (escape hatch trigger) untuk memicu branch "no normal entry"
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL app.allow_ledger_delete = 'on'`);
      await tx.$executeRawUnsafe(
        `DELETE FROM ledger_entries WHERE transaction_id = '${txId}'::uuid AND reversal_of IS NULL`,
      );
    });

    const res = await reverseTx(chair.tokenPlain, eventId, txId, "reverse tanpa ledger");
    if (res.status !== 409) {
      console.error(
        "FG-GAP5 endpoint=POST /transactions/:txId/reverse (no ledger) harapan=409 aktual=" +
          res.status +
          " body=" +
          JSON.stringify(res.body),
      );
    }
    expect(res.status).toBe(409);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe("CONFLICT");
  });
});

// ============================================================================
// Finance gap: reverseTransaction P2002 double-reversal race → 409
// ============================================================================
describe("Finance coverage gap: reverseTransaction concurrent double-reverse", () => {
  it("dua reverse paralel pada transaksi PAID yang sama → satu 201, satu 409 (P2002)", async () => {
    const chair = await createUserAndSession();
    const { eventId } = await createEventAndChair(chair.id);

    const rCreate = await createTx(chair.tokenPlain, eventId, {
      type: "EXPENSE", category: "VENUE", description: "double reverse race", amount: "900000.00",
    });
    expect(rCreate.status).toBe(201);
    const txId = rCreate.body.data.id;
    await submitTx(chair.tokenPlain, eventId, txId);
    await approveTx(chair.tokenPlain, eventId, txId);
    await payTx(chair.tokenPlain, eventId, txId);

    const results = await Promise.allSettled([
      reverseTx(chair.tokenPlain, eventId, txId, "reverse pertama"),
      reverseTx(chair.tokenPlain, eventId, txId, "reverse kedua"),
    ]);

    const statuses = results.map(
      (r) => (r.status === "fulfilled" ? r.value.status : null),
    );
    const count201 = statuses.filter((s) => s === 201).length;
    const count409 = statuses.filter((s) => s === 409).length;

    if (count201 !== 1 || count409 !== 1) {
      console.error(
        "FG-GAP6 endpoint=POST /transactions/:txId/reverse (concurrent) harapan=1x201+1x409 aktual=" +
          JSON.stringify(statuses),
      );
    }
    expect(count201).toBe(1);
    expect(count409).toBe(1);

    // Verifikasi hanya satu reversal entry di DB
    const reversals = await prisma.ledgerEntry.count({
      where: { transactionId: txId, reversalOfId: { not: null } },
    });
    expect(reversals).toBe(1);
  });
});
