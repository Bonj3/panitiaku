import { hash } from "@node-rs/argon2";
import { prisma } from "../src/config/database.js";
import { createApp } from "../src/app.ts";
import { hashToken } from "../src/shared/utils/token.js";
import supertest from "supertest";

export const app = createApp();
export const ORIGIN = "http://localhost:5173";

export let sharedCsrf: string;
export let sharedTokenPlain: string;
export const testUserIds: string[] = [];
export const testEventIds: string[] = [];

export function email(label: string): string {
  return `fin.${label}.${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
}

export function cookieHeader(tokenPlain: string, csrfToken: string): string {
  return `ec_csrf=${csrfToken}; ec_session=${tokenPlain}`;
}

export async function ensureCsrf() {
  const getRes = await supertest(app).get("/api/v1/health").set("Origin", ORIGIN);
  const m = getRes.headers["set-cookie"];
  const arr = Array.isArray(m) ? m : [m];
  const c = arr.find((x) => x.startsWith("ec_csrf="));
  if (!c) throw new Error("ec_csrf tidak tersedia");
  sharedCsrf = c.split(";")[0].split("=")[1];
}

export async function makeAgent(_role: "EVENT_CHAIR" | "DIVISION_LEADER" | "MEMBER" = "MEMBER") {
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

export async function makeEventAndMembership(userId: string) {
  const event = await prisma.event.create({
    data: { name: "Fin Event", slug: `fin-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, createdById: userId },
  });
  testEventIds.push(event.id);
  const membership = await prisma.eventMember.create({
    data: { eventId: event.id, userId, role: "EVENT_CHAIR", parentId: null, title: "Ketua", status: "ACTIVE" },
  });
  return { eventId: event.id, membershipId: membership.id };
}

export async function makeMemberInEvent(
  eventId: string, userId: string, role: "MEMBER" | "DIVISION_LEADER" = "MEMBER", parentId: string | null = null,
) {
  return prisma.eventMember.create({ data: { eventId, userId, role, parentId, title: role, status: "ACTIVE" } });
}

export async function makeMemberInactive(eventId: string, userId: string, parentId: string | null) {
  return prisma.eventMember.create({ data: { eventId, userId, role: "MEMBER", parentId, title: "Member", status: "INACTIVE" } });
}

const headers = (tokenPlain: string) => ({
  Origin: ORIGIN,
  Cookie: cookieHeader(tokenPlain, sharedCsrf),
  "X-CSRF-Token": sharedCsrf,
});

export async function createTx(tokenPlain: string, eventId: string, input: any) {
  return supertest(app).post(`/api/v1/events/${eventId}/transactions`).set(headers(tokenPlain)).send(input);
}
export async function submitTx(tokenPlain: string, eventId: string, txId: string) {
  return supertest(app).post(`/api/v1/events/${eventId}/transactions/${txId}/submit`).set(headers(tokenPlain)).send({});
}
export async function approveTx(tokenPlain: string, eventId: string, txId: string) {
  return supertest(app).post(`/api/v1/events/${eventId}/transactions/${txId}/approve`).set(headers(tokenPlain)).send({});
}
export async function payTx(tokenPlain: string, eventId: string, txId: string) {
  return supertest(app).post(`/api/v1/events/${eventId}/transactions/${txId}/pay`).set(headers(tokenPlain)).send({});
}
export async function reverseTx(tokenPlain: string, eventId: string, txId: string, reason: string) {
  return supertest(app).post(`/api/v1/events/${eventId}/transactions/${txId}/reverse`).set(headers(tokenPlain)).send({ reason });
}
export async function cancelTx(tokenPlain: string, eventId: string, txId: string, reason?: string) {
  return supertest(app).post(`/api/v1/events/${eventId}/transactions/${txId}/cancel`).set(headers(tokenPlain)).send({ ...(reason ? { reason } : {}) });
}
export async function reopenTx(tokenPlain: string, eventId: string, txId: string) {
  return supertest(app).post(`/api/v1/events/${eventId}/transactions/${txId}/reopen`).set(headers(tokenPlain)).send({});
}
export async function patchTx(tokenPlain: string, eventId: string, txId: string, body: any) {
  return supertest(app).patch(`/api/v1/events/${eventId}/transactions/${txId}`).set(headers(tokenPlain)).send(body);
}
export async function getSummary(tokenPlain: string, eventId: string) {
  return supertest(app).get(`/api/v1/events/${eventId}/finance/summary`).set(headers(tokenPlain));
}
export async function listTx(tokenPlain: string, eventId: string, query?: Record<string, string>) {
  const url = new URL(`/api/v1/events/${eventId}/transactions`, "http://localhost");
  if (query) for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  return supertest(app).get(url.pathname + url.search).set(headers(tokenPlain));
}
export async function getDetail(tokenPlain: string, eventId: string, txId: string) {
  return supertest(app).get(`/api/v1/events/${eventId}/transactions/${txId}`).set(headers(tokenPlain));
}
export async function closeEventApi(tokenPlain: string, eventId: string) {
  return supertest(app).post(`/api/v1/events/${eventId}/close`).set(headers(tokenPlain)).send({ confirm: true });
}
export async function rejectTxRaw(tokenPlain: string, eventId: string, txId: string, body: any) {
  return supertest(app).post(`/api/v1/events/${eventId}/transactions/${txId}/reject`).set(headers(tokenPlain)).send(body);
}

export async function listEvidence(
  tokenPlain: string,
  eventId: string,
  txId: string
) {
  return supertest(app)
    .get(`/api/v1/events/${eventId}/transactions/${txId}/evidence`)
    .set(headers(tokenPlain));
}

/**
 * Bersihkan semua data uji finance dalam satu DB transaction.
 *
 * Urutan aman untuk menghindari FK RESTRICT dan trigger ledger-immutable:
 *   1. SET LOCAL app.allow_ledger_delete = 'on'  (escape hatch trigger, hanya cleanup test)
 *   2. ledger_entries reversal_of IS NOT NULL dulu (FK self RESTRICT), lalu semua ledger event uji
 *   3. transaction_history (via financial_transactions.eventId)
 *   4. financial_transactions (eventId in ids)
 *   5. invitations (eventId in ids)
 *   6. event_members bottom-up: non-root leaves dulu, baru root (parentId = null)
 *   7. events, sessions, users
 *   8. Kosongkan testEventIds / testUserIds setelah selesai.
 *
 * Jika cleanup gagal, error dibiarkan menyebar agar test suite gagal (tidak disembunyikan).
 */
/**
 * Bersihkan semua data uji finance dalam satu DB transaction.
 *
 * Menggunakan prefix fixture (`slug LIKE 'fin-%'`, `email LIKE 'fin.%'`) sehingga
 * tidak tergantung pada parameter array (yang tidak cocok dengan `ANY()` di
 * Prisma raw query) dan tidak tergantung pada shared state antar fork Vitest.
 * Suite dijalankan sequential (`maxWorkers=1`), sehingga tidak ada race condition
 * dengan test lain.
 *
 * Escape hatch trigger: `SET LOCAL app.allow_ledger_delete = 'on'` dipanggil
 * sebagai statement pertama dalam transaction Prisma, sehingga SET LOCAL berlaku
 * untuk seluruh DELETE di transaction yang sama. Trigger produksi tetap aktif
 * sepanjang waktu dan otomatis kembali ke keadaan normal saat transaction
 * selesai (commit/rollback), bahkan jika proses crash di antaranya.
 *
 * Jika cleanup gagal, error dibiarkan menyebar (tidak disembunyikan) agar test
 * suite gagal dan terlihat.
 */
export async function cleanupTestData(): Promise<void> {
  await prisma.$transaction(async (tx) => {
    // Escape hatch trigger ledger_entries_immutable hanya untuk transaction ini.
    await tx.$executeRawUnsafe(`SET LOCAL app.allow_ledger_delete = 'on'`);

    // Ledger dulu (FK self RESTRICT pada reversal_of, dan FK ke transactions).
    await tx.$executeRawUnsafe(
      `DELETE FROM ledger_entries WHERE reversal_of IS NOT NULL AND event_id IN (SELECT id FROM events WHERE slug LIKE 'fin-%')`,
    );
    await tx.$executeRawUnsafe(
      `DELETE FROM ledger_entries WHERE event_id IN (SELECT id FROM events WHERE slug LIKE 'fin-%')`,
    );

    // Transaction history, financial_transactions, invitations, audit_logs.
    // Hapus audit_logs untuk event uji SEBELUM event_members (actor_id
    // FK RESTRICT mencegah hapus anggota yang masih direferensi log).
    await tx.$executeRawUnsafe(
      `DELETE FROM audit_logs WHERE event_id IN (SELECT id FROM events WHERE slug LIKE 'fin-%')`
    );
    await tx.$executeRawUnsafe(
      `DELETE FROM transaction_history WHERE transaction_id IN (SELECT id FROM financial_transactions WHERE event_id IN (SELECT id FROM events WHERE slug LIKE 'fin-%'))`,
    );
    await tx.$executeRawUnsafe(
      `DELETE FROM financial_transactions WHERE event_id IN (SELECT id FROM events WHERE slug LIKE 'fin-%')`,
    );
    await tx.$executeRawUnsafe(
      `DELETE FROM invitations WHERE event_id IN (SELECT id FROM events WHERE slug LIKE 'fin-%')`,
    );

    // Event members bottom-up (FK parent_id self RESTRICT): non-root leaves
    // dulu, baru root. Constraint chair_is_root adalah CHECK, tidak aktif DELETE.
    await tx.$executeRawUnsafe(`
      DELETE FROM event_members
      WHERE event_id IN (SELECT id FROM events WHERE slug LIKE 'fin-%')
        AND parent_id IS NOT NULL
        AND id NOT IN (
          SELECT DISTINCT parent_id FROM event_members
          WHERE event_id IN (SELECT id FROM events WHERE slug LIKE 'fin-%')
            AND parent_id IS NOT NULL
        );
    `);
    await tx.$executeRawUnsafe(`
      DELETE FROM event_members
      WHERE event_id IN (SELECT id FROM events WHERE slug LIKE 'fin-%');
    `);

    // Events (CASCADE ke audit_logs, invitations, event_members, financial_transactions,
    // ledger_entries, transaction_history — tapi delete explicit di atas sudah membersihkan
    // yang berhubungan finance; audit_logs dipastikan bersih di sini juga).
    await tx.$executeRawUnsafe(
      `DELETE FROM audit_logs WHERE event_id IN (SELECT id FROM events WHERE slug LIKE 'fin-%')`,
    );
    await tx.$executeRawUnsafe(`DELETE FROM events WHERE slug LIKE 'fin-%'`);
    await tx.$executeRawUnsafe(
      `DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'fin.%')`,
    );
    await tx.$executeRawUnsafe(`DELETE FROM users WHERE email LIKE 'fin.%'`);
  });

  // Kosongkan array helper (sumber kebenaran untuk ops & close).
  testEventIds.splice(0, testEventIds.length);
  testUserIds.splice(0, testUserIds.length);
}
