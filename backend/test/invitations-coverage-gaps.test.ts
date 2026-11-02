import { hash } from "@node-rs/argon2";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../src/config/database.js";
import { createApp } from "../src/app.ts";
import { hashToken } from "../src/shared/utils/token.js";
import supertest from "supertest";

// ---------------------------------------------------------------------------
// Coverage-gap tests for uncovered invitation.service.ts branches:
//   - revokeInvitation: actor INACTIVE (403)
//   - revokeInvitation: DIVISION_LEADER bukan inviter dan parent di luar subtree (403)
//   - revokeInvitation: sudah final / updateMany count !== 1 (409)
// ---------------------------------------------------------------------------

const app = createApp();
const ORIGIN = "http://localhost:5173";

const testUserIds: string[] = [];
const testEventIds: string[] = [];

function email(label: string): string {
  return `ig.${label}.${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
}

function cookieHeader(tokenPlain: string, csrfToken: string): string {
  return `ec_csrf=${csrfToken}; ec_session=${tokenPlain}`;
}

let sharedCsrf: string;

async function createUserAndSession() {
  const e = email("user");
  const passwordHash = await hash("password123");
  const user = await prisma.user.create({ data: { name: "IG User", email: e, passwordHash } });
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
    data: { name: "IG Event", slug: `ig-${Date.now()}`, createdById: userId },
  });
  testEventIds.push(event.id);

  const membership = await prisma.eventMember.create({
    data: { eventId: event.id, userId, role: "EVENT_CHAIR", parentId: null, title: "Ketua", status: "ACTIVE" },
  });
  return { eventId: event.id, chairMemberId: membership.id };
}

async function createMember({
  eventId,
  userId,
  role = "MEMBER",
  parentId,
  status = "ACTIVE",
}) {
  return prisma.eventMember.create({ data: { eventId, userId, role, parentId, title: role, status } });
}

function headers(tokenPlain: string) {
  return {
    Origin: ORIGIN,
    Cookie: cookieHeader(tokenPlain, sharedCsrf),
    "X-CSRF-Token": sharedCsrf,
  };
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

afterEach(async () => {
  if (testUserIds.length) {
    await prisma.session.deleteMany({ where: { userId: { in: testUserIds } } });
  }
});

afterAll(async () => {
  if (testEventIds.length) {
    await prisma.auditLog.deleteMany({ where: { eventId: { in: testEventIds } } });
    await prisma.event.deleteMany({ where: { id: { in: testEventIds } } });
  }
  if (testUserIds.length) {
    await prisma.session.deleteMany({ where: { userId: { in: testUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: testUserIds } } });
  }
  await prisma.$disconnect();
});

// ============================================================================
// Invitations gap: revoke — actor INACTIVE → 403
// ============================================================================
describe("Invitations coverage gap: revoke actor INACTIVE", () => {
  it("DIVISION_LEADER yang status-nya INACTIVE mencoba revoke → 403 FORBIDDEN", async () => {
    const chair = await createUserAndSession();
    const { eventId, chairMemberId } = await createEventAndChair(chair.id);

    const leader = await createUserAndSession();
    const leaderMember = await createMember({
      eventId, userId: leader.id, role: "DIVISION_LEADER", parentId: chairMemberId, status: "ACTIVE",
    });

    const invitee = await createUserAndSession();
    const createRes = await supertest(app)
      .post(`/api/v1/events/${eventId}/invitations`)
      .set(headers(leader.tokenPlain))
      .send({ email: invitee.email, role: "MEMBER", parentId: leaderMember.id });
    expect(createRes.status).toBe(201);
    const invitationId = createRes.body.data.invitation.id;

    // Nonaktifkan leader melalui Chair
    await supertest(app)
      .patch(`/api/v1/events/${eventId}/members/${leaderMember.id}/status`)
      .set(headers(chair.tokenPlain))
      .send({ status: "INACTIVE" });

    // Leader (sudah INACTIVE) mencoba revoke → 403
    const res = await supertest(app)
      .post(`/api/v1/events/${eventId}/invitations/${invitationId}/revoke`)
      .set(headers(leader.tokenPlain));
    if (res.status !== 403) {
      console.error(
        "IG-GAP1 endpoint=POST /invitations/:id/revoke (actor inactive) harapan=403 aktual=" +
          res.status +
          " body=" +
          JSON.stringify(res.body),
      );
    }
    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe("FORBIDDEN");
  });
});

// ============================================================================
// Invitations gap: revoke — DIVISION_LEADER bukan inviter, parent di luar subtree → 403
// ============================================================================
describe("Invitations coverage gap: revoke DIVISION_LEADER di luar subtree", () => {
  it("DIVISION_LEADER A mencoba revoke undangan buatan DIVISION_LEADER B (parent di luar subtree A) → 403", async () => {
    const chair = await createUserAndSession();
    const { eventId, chairMemberId } = await createEventAndChair(chair.id);

    // Leader A (subtree chair)
    const leaderA = await createUserAndSession();
    const leaderAMember = await createMember({
      eventId, userId: leaderA.id, role: "DIVISION_LEADER", parentId: chairMemberId, status: "ACTIVE",
    });
    void leaderAMember;

    // Leader B (subtree chair, cabang lain)
    const leaderB = await createUserAndSession();
    const leaderBMember = await createMember({
      eventId, userId: leaderB.id, role: "DIVISION_LEADER", parentId: chairMemberId, status: "ACTIVE",
    });

    // Anggota dalam subtree Leader B
    const memberB = await createUserAndSession();
    const memberBMember = await createMember({
      eventId, userId: memberB.id, role: "MEMBER", parentId: leaderBMember.id, status: "ACTIVE",
    });

    // Leader B membuat undangan dengan parent = memberB (dalam subtree B)
    const createRes = await supertest(app)
      .post(`/api/v1/events/${eventId}/invitations`)
      .set(headers(leaderB.tokenPlain))
      .send({ email: email("invitee"), role: "MEMBER", parentId: memberBMember.id });
    expect(createRes.status).toBe(201);
    const invitationId = createRes.body.data.invitation.id;

    // Leader A mencoba revoke undangan buatan Leader B:
    // - bukan inviter (invited_by = leaderB.id, bukan leaderA.id)
    // - parent (memberB) tidak berada dalam subtree Leader A
    const res = await supertest(app)
      .post(`/api/v1/events/${eventId}/invitations/${invitationId}/revoke`)
      .set(headers(leaderA.tokenPlain));
    if (res.status !== 403) {
      console.error(
        "IG-GAP2 endpoint=POST /invitations/:id/revoke (DL luar subtree) harapan=403 aktual=" +
          res.status +
          " body=" +
          JSON.stringify(res.body),
      );
    }
    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe("FORBIDDEN");
  });
});

// ============================================================================
// Invitations gap: create — event tidak ditemukan (404), parent tidak ditemukan (404), parent INACTIVE (422)
// ============================================================================
describe("Invitations coverage gap: create error paths", () => {
  it("create undangan pada event yang tidak ada → 404 NOT_FOUND", async () => {
    const chair = await createUserAndSession();
    const fakeEventId = "00000000-0000-0000-0000-000000000000";

    const res = await supertest(app)
      .post(`/api/v1/events/${fakeEventId}/invitations`)
      .set(headers(chair.tokenPlain))
      .send({ email: email("x"), role: "MEMBER", parentId: "00000000-0000-0000-0000-000000000000" });
    if (res.status !== 404) {
      console.error(
        "IG-GAP7 endpoint=POST /events/:eventId/invitations (event tidak ada) harapan=404 aktual=" +
          res.status +
          " body=" +
          JSON.stringify(res.body),
      );
    }
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });

  it("create undangan dengan parentId yang tidak ada → 404 NOT_FOUND", async () => {
    const chair = await createUserAndSession();
    const { eventId } = await createEventAndChair(chair.id);

    const fakeParentId = "00000000-0000-0000-0000-000000000000";
    const res = await supertest(app)
      .post(`/api/v1/events/${eventId}/invitations`)
      .set(headers(chair.tokenPlain))
      .send({ email: email("x"), role: "MEMBER", parentId: fakeParentId });
    if (res.status !== 404) {
      console.error(
        "IG-GAP8 endpoint=POST /events/:eventId/invitations (parent tidak ada) harapan=404 aktual=" +
          res.status +
          " body=" +
          JSON.stringify(res.body),
      );
    }
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });

  it("create undangan dengan parent INACTIVE → 422 UNPROCESSABLE", async () => {
    const chair = await createUserAndSession();
    const { eventId, chairMemberId } = await createEventAndChair(chair.id);

    const inactiveUser = await createUserAndSession();
    const inactiveMember = await createMember({
      eventId, userId: inactiveUser.id, role: "MEMBER", parentId: chairMemberId, status: "INACTIVE",
    });

    const res = await supertest(app)
      .post(`/api/v1/events/${eventId}/invitations`)
      .set(headers(chair.tokenPlain))
      .send({ email: email("x"), role: "MEMBER", parentId: inactiveMember.id });
    if (res.status !== 422) {
      console.error(
        "IG-GAP9 endpoint=POST /events/:eventId/invitations (parent INACTIVE) harapan=422 aktual=" +
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
// Invitations gap: revoke — concurrent double-revoke (race condition) → 409
// ============================================================================
describe("Invitations coverage gap: revoke concurrent race", () => {
  it("dua revoke paralel pada undangan PENDING yang sama → satu 200, satu 409", async () => {
    const chair = await createUserAndSession();
    const { eventId, chairMemberId } = await createEventAndChair(chair.id);

    const invitee = await createUserAndSession();
    const createRes = await supertest(app)
      .post(`/api/v1/events/${eventId}/invitations`)
      .set(headers(chair.tokenPlain))
      .send({ email: invitee.email, role: "MEMBER", parentId: chairMemberId });
    expect(createRes.status).toBe(201);
    const invitationId = createRes.body.data.invitation.id;

    const results = await Promise.allSettled([
      supertest(app)
        .post(`/api/v1/events/${eventId}/invitations/${invitationId}/revoke`)
        .set(headers(chair.tokenPlain)),
      supertest(app)
        .post(`/api/v1/events/${eventId}/invitations/${invitationId}/revoke`)
        .set(headers(chair.tokenPlain)),
    ]);

    const statuses = results.map(
      (r) => (r.status === "fulfilled" ? r.value.status : null),
    );
    const count200 = statuses.filter((s) => s === 200).length;
    const count409 = statuses.filter((s) => s === 409).length;

    if (count200 !== 1 || count409 !== 1) {
      console.error(
        "IG-GAP10 endpoint=POST /invitations/:id/revoke (concurrent) harapan=1x200+1x409 aktual=" +
          JSON.stringify(statuses),
      );
    }
    expect(count200).toBe(1);
    expect(count409).toBe(1);
  });
});

// ============================================================================
// Invitations gap: revoke — sudah final (updateMany count !== 1) → 409
// ============================================================================
describe("Invitations coverage gap: revoke already final", () => {
  it("revoke undangan yang sudah REVOKED → 409 CONFLICT", async () => {
    const chair = await createUserAndSession();
    const { eventId, chairMemberId } = await createEventAndChair(chair.id);

    const invitee = await createUserAndSession();
    const createRes = await supertest(app)
      .post(`/api/v1/events/${eventId}/invitations`)
      .set(headers(chair.tokenPlain))
      .send({ email: invitee.email, role: "MEMBER", parentId: chairMemberId });
    expect(createRes.status).toBe(201);
    const invitationId = createRes.body.data.invitation.id;

    // Revoke pertama → 200
    const rev1 = await supertest(app)
      .post(`/api/v1/events/${eventId}/invitations/${invitationId}/revoke`)
      .set(headers(chair.tokenPlain));
    expect(rev1.status).toBe(200);

    // Revoke kedua (sudah final) → 409
    const rev2 = await supertest(app)
      .post(`/api/v1/events/${eventId}/invitations/${invitationId}/revoke`)
      .set(headers(chair.tokenPlain));
    if (rev2.status !== 409) {
      console.error(
        "IG-GAP3 endpoint=POST /invitations/:id/revoke (sudah final) harapan=409 aktual=" +
          rev2.status +
          " body=" +
          JSON.stringify(rev2.body),
      );
    }
    expect(rev2.status).toBe(409);
    expect(rev2.body.success).toBe(false);
    expect(rev2.body.error.code).toBe("CONFLICT");
  });

  it("revoke undangan yang sudah ACCEPTED → 409 CONFLICT", async () => {
    const chair = await createUserAndSession();
    const { eventId, chairMemberId } = await createEventAndChair(chair.id);

    const invitee = await createUserAndSession();
    const createRes = await supertest(app)
      .post(`/api/v1/events/${eventId}/invitations`)
      .set(headers(chair.tokenPlain))
      .send({ email: invitee.email, role: "MEMBER", parentId: chairMemberId });
    expect(createRes.status).toBe(201);
    const token = createRes.body.data.token;
    const invitationId = createRes.body.data.invitation.id;

    // Accept undangan → ACCEPTED
    const acc = await supertest(app)
      .post(`/api/v1/invitations/${token}/accept`)
      .set(headers(invitee.tokenPlain));
    expect(acc.status).toBe(201);

    // Revoke undangan yang sudah ACCEPTED → 409
    const rev = await supertest(app)
      .post(`/api/v1/events/${eventId}/invitations/${invitationId}/revoke`)
      .set(headers(chair.tokenPlain));
    if (rev.status !== 409) {
      console.error(
        "IG-GAP4 endpoint=POST /invitations/:id/revoke (accepted) harapan=409 aktual=" +
          rev.status +
          " body=" +
          JSON.stringify(rev.body),
      );
    }
    expect(rev.status).toBe(409);
    expect(rev.body.success).toBe(false);
    expect(rev.body.error.code).toBe("CONFLICT");
  });
});

// ============================================================================
// Invitations gap: getPublicDetail expired PENDING → 410
// ============================================================================
describe("Invitations coverage gap: getPublicDetail expired", () => {
  it("undangan PENDING tapi expired via GET publik → 410 GONE", async () => {
    const chair = await createUserAndSession();
    const { eventId, chairMemberId } = await createEventAndChair(chair.id);

    const invitee = await createUserAndSession();
    const createRes = await supertest(app)
      .post(`/api/v1/events/${eventId}/invitations`)
      .set(headers(chair.tokenPlain))
      .send({ email: invitee.email, role: "MEMBER", parentId: chairMemberId });
    expect(createRes.status).toBe(201);
    const token = createRes.body.data.token;

    // Set expiresAt ke masa lalu
    await prisma.invitation.update({
      where: { tokenHash: hashToken(token) },
      data: { expiresAt: new Date(Date.now() - 60 * 60 * 1000) },
    });

    // GET publik → 410 (lazy expiry + expired check)
    const pub = await supertest(app).get(`/api/v1/invitations/${token}`);
    if (pub.status !== 410) {
      console.error(
        "IG-GAP11 endpoint=GET /invitations/:token (expired pending) harapan=410 aktual=" +
          pub.status +
          " body=" +
          JSON.stringify(pub.body),
      );
    }
    expect(pub.status).toBe(410);
    expect(pub.body.success).toBe(false);
    expect(pub.body.error.code).toBe("GONE");
  });
});

// ============================================================================
// Invitations gap: concurrent create same email → P2002 → 409
// ============================================================================
describe("Invitations coverage gap: concurrent create same email", () => {
  it("dua create paralel email yang sama → satu 201, satu 409 (P2002)", async () => {
    const chair = await createUserAndSession();
    const { eventId, chairMemberId } = await createEventAndChair(chair.id);

    const invitee = await createUserAndSession();
    const emailAddr = invitee.email;

    const results = await Promise.allSettled([
      supertest(app)
        .post(`/api/v1/events/${eventId}/invitations`)
        .set(headers(chair.tokenPlain))
        .send({ email: emailAddr, role: "MEMBER", parentId: chairMemberId }),
      supertest(app)
        .post(`/api/v1/events/${eventId}/invitations`)
        .set(headers(chair.tokenPlain))
        .send({ email: emailAddr, role: "MEMBER", parentId: chairMemberId }),
    ]);

    const statuses = results.map(
      (r) => (r.status === "fulfilled" ? r.value.status : null),
    );
    const count201 = statuses.filter((s) => s === 201).length;
    const count409 = statuses.filter((s) => s === 409).length;

    if (count201 !== 1 || count409 !== 1) {
      console.error(
        "IG-GAP12 endpoint=POST /events/:eventId/invitations (concurrent same email) harapan=1x201+1x409 aktual=" +
          JSON.stringify(statuses),
      );
    }
    expect(count201).toBe(1);
    expect(count409).toBe(1);

    // Tepat satu undangan di DB
    const count = await prisma.invitation.count({
      where: { eventId, email: emailAddr },
    });
    expect(count).toBe(1);
  });
});

// ============================================================================
// Invitations gap: create — email sudah anggota ACTIVE → 409
// ============================================================================
describe("Invitations coverage gap: create existing active member", () => {
  it("create undangan untuk email yang sudah anggota ACTIVE → 409 CONFLICT", async () => {
    const chair = await createUserAndSession();
    const { eventId, chairMemberId } = await createEventAndChair(chair.id);

    const existingUser = await createUserAndSession();
    await createMember({
      eventId, userId: existingUser.id, role: "MEMBER", parentId: chairMemberId, status: "ACTIVE",
    });

    const res = await supertest(app)
      .post(`/api/v1/events/${eventId}/invitations`)
      .set(headers(chair.tokenPlain))
      .send({ email: existingUser.email, role: "MEMBER", parentId: chairMemberId });
    if (res.status !== 409) {
      console.error(
        "IG-GAP13 endpoint=POST /events/:eventId/invitations (email aktif) harapan=409 aktual=" +
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
// Invitations gap: revoke — undangan tidak ada → 404
// ============================================================================
describe("Invitations coverage gap: revoke not found", () => {
  it("revoke undanganId yang tidak ada → 404 NOT_FOUND", async () => {
    const chair = await createUserAndSession();
    const { eventId } = await createEventAndChair(chair.id);

    const fakeInvitationId = "00000000-0000-0000-0000-000000000000";
    const res = await supertest(app)
      .post(`/api/v1/events/${eventId}/invitations/${fakeInvitationId}/revoke`)
      .set(headers(chair.tokenPlain));
    if (res.status !== 404) {
      console.error(
        "IG-GAP14 endpoint=POST /invitations/:id/revoke (not found) harapan=404 aktual=" +
          res.status +
          " body=" +
          JSON.stringify(res.body),
      );
    }
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });
});

// ============================================================================
// Invitations gap: listInvitations — DIVISION_LEADER subtree filter
// ============================================================================
describe("Invitations coverage gap: list DIVISION_LEADER subtree", () => {
  it("DIVISION_LEADER list undangan hanya yang parentId dalam subtree-nya", async () => {
    const chair = await createUserAndSession();
    const { eventId, chairMemberId } = await createEventAndChair(chair.id);

    // Leader A dan Leader B (kedua di subtree Chair)
    const leaderA = await createUserAndSession();
    const leaderAMember = await createMember({
      eventId, userId: leaderA.id, role: "DIVISION_LEADER", parentId: chairMemberId, status: "ACTIVE",
    });
    const leaderB = await createUserAndSession();
    const leaderBMember = await createMember({
      eventId, userId: leaderB.id, role: "DIVISION_LEADER", parentId: chairMemberId, status: "ACTIVE",
    });

    // Anggota di bawah masing-masing leader
    const memberA = await createUserAndSession();
    const memberAMember = await createMember({
      eventId, userId: memberA.id, role: "MEMBER", parentId: leaderAMember.id, status: "ACTIVE",
    });
    const memberB = await createUserAndSession();
    const memberBMember = await createMember({
      eventId, userId: memberB.id, role: "MEMBER", parentId: leaderBMember.id, status: "ACTIVE",
    });

    // Leader A undang dengan parent = memberA (dalam subtree A)
    const emailA = email("invA");
    const invA = await supertest(app)
      .post(`/api/v1/events/${eventId}/invitations`)
      .set(headers(leaderA.tokenPlain))
      .send({ email: emailA, role: "MEMBER", parentId: memberAMember.id });
    expect(invA.status).toBe(201);
    const invAId = invA.body.data.invitation.id;

    // Leader B undang dengan parent = memberB (dalam subtree B)
    const emailB = email("invB");
    const invB = await supertest(app)
      .post(`/api/v1/events/${eventId}/invitations`)
      .set(headers(leaderB.tokenPlain))
      .send({ email: emailB, role: "MEMBER", parentId: memberBMember.id });
    expect(invB.status).toBe(201);

    // Leader A list → hanya undangan dengan parent di subtree A (invA, bukan invB)
    const listA = await supertest(app)
      .get(`/api/v1/events/${eventId}/invitations`)
      .set(headers(leaderA.tokenPlain));
    if (listA.status !== 200) {
      console.error(
        "IG-GAP15 endpoint=GET /events/:eventId/invitations (DL list) harapan=200 aktual=" +
          listA.status +
          " body=" +
          JSON.stringify(listA.body),
      );
    }
    expect(listA.status).toBe(200);
    const idsA = listA.body.data.items.map((i: { id: string }) => i.id);
    expect(idsA).toContain(invAId);
    expect(idsA).not.toContain(invB.body.data.invitation.id);
  });
});

// ============================================================================
// Invitations gap: getPublicDetail — token tidak valid → 404
// ============================================================================
describe("Invitations coverage gap: getPublicDetail invalid token", () => {
  it("GET /invitations/:token yang tidak valid → 404 NOT_FOUND", async () => {
    const fakeToken = "token_tidak_valid_12345";
    const res = await supertest(app).get(`/api/v1/invitations/${fakeToken}`);
    if (res.status !== 404) {
      console.error(
        "IG-GAP16 endpoint=GET /invitations/:token (invalid) harapan=404 aktual=" +
          res.status +
          " body=" +
          JSON.stringify(res.body),
      );
    }
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });
});
