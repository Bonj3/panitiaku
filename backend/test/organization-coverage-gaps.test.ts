import { hash } from "@node-rs/argon2";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../src/config/database.js";
import { createApp } from "../src/app.ts";
import { hashToken } from "../src/shared/utils/token.js";
import supertest from "supertest";

// ---------------------------------------------------------------------------
// Coverage-gap tests for uncovered organization.service.ts branches:
//   - moveMember: newParent INACTIVE → 422
//   - moveMember: MEMBER actor → 403
//   - moveMember: non-noop update path → 200 {noop: false}
// ---------------------------------------------------------------------------

const app = createApp();
const ORIGIN = "http://localhost:5173";

const testUserIds: string[] = [];
const testEventIds: string[] = [];

function email(label: string): string {
  return `og.${label}.${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
}

function cookieHeader(tokenPlain: string, csrfToken: string): string {
  return `ec_csrf=${csrfToken}; ec_session=${tokenPlain}`;
}

let sharedCsrf: string;

async function createUserAndSession() {
  const e = email("user");
  const passwordHash = await hash("password123");
  const user = await prisma.user.create({ data: { name: "OG User", email: e, passwordHash } });
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
    data: { name: "OG Event", slug: `og-${Date.now()}`, createdById: userId },
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
// Organization gap: move — newParent INACTIVE → 422
// ============================================================================
describe("Organization coverage gap: move newParent INACTIVE", () => {
  it("move anggota dengan induk baru status INACTIVE → 422 UNPROCESSABLE", async () => {
    const chair = await createUserAndSession();
    const { eventId, chairMemberId } = await createEventAndChair(chair.id);

    const member = await createUserAndSession();
    const memberNode = await createMember({
      eventId, userId: member.id, role: "MEMBER", parentId: chairMemberId, status: "ACTIVE",
    });

    const inactiveParent = await createUserAndSession();
    await createMember({
      eventId, userId: inactiveParent.id, role: "MEMBER", parentId: chairMemberId, status: "INACTIVE",
    });
    const inactiveMember = await prisma.eventMember.findFirst({
      where: { eventId, userId: inactiveParent.id },
    });

    const res = await supertest(app)
      .post(`/api/v1/events/${eventId}/members/${memberNode.id}/move`)
      .set(headers(chair.tokenPlain))
      .send({ newParentId: inactiveMember!.id });
    if (res.status !== 422) {
      console.error(
        "OG-GAP1 endpoint=POST /members/:id/move (newParent INACTIVE) harapan=422 aktual=" +
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
// Organization gap: move — MEMBER actor → 403
// ============================================================================
describe("Organization coverage gap: move MEMBER actor", () => {
  it("MEMBER mencoba move anggota → 403 FORBIDDEN", async () => {
    const chair = await createUserAndSession();
    const { eventId, chairMemberId } = await createEventAndChair(chair.id);

    const member = await createUserAndSession();
    const memberNode = await createMember({
      eventId, userId: member.id, role: "MEMBER", parentId: chairMemberId, status: "ACTIVE",
    });

    const target = await createUserAndSession();
    const targetNode = await createMember({
      eventId, userId: target.id, role: "MEMBER", parentId: chairMemberId, status: "ACTIVE",
    });

    const res = await supertest(app)
      .post(`/api/v1/events/${eventId}/members/${targetNode.id}/move`)
      .set(headers(member.tokenPlain))
      .send({ newParentId: memberNode.id });
    if (res.status !== 403) {
      console.error(
        "OG-GAP2 endpoint=POST /members/:id/move (MEMBER actor) harapan=403 aktual=" +
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
// Organization gap: move — target tidak ditemukan (404)
// ============================================================================
describe("Organization coverage gap: move target not found", () => {
  it("move memberId yang tidak ada → 404 NOT_FOUND", async () => {
    const chair = await createUserAndSession();
    const { eventId, chairMemberId } = await createEventAndChair(chair.id);

    const fakeMemberId = "00000000-0000-0000-0000-000000000000";
    const res = await supertest(app)
      .post(`/api/v1/events/${eventId}/members/${fakeMemberId}/move`)
      .set(headers(chair.tokenPlain))
      .send({ newParentId: chairMemberId });
    if (res.status !== 404) {
      console.error(
        "OG-GAP5 endpoint=POST /members/:id/move (target tidak ada) harapan=404 aktual=" +
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
describe("Organization coverage gap: move non-noop", () => {
  it("Chair move anggota ke parent lain dalam subtree → 200 {noop: false}", async () => {
    const chair = await createUserAndSession();
    const { eventId, chairMemberId } = await createEventAndChair(chair.id);

    const member = await createUserAndSession();
    const memberNode = await createMember({
      eventId, userId: member.id, role: "MEMBER", parentId: chairMemberId, status: "ACTIVE",
    });

    const div = await createUserAndSession();
    const divMember = await createMember({
      eventId, userId: div.id, role: "DIVISION_LEADER", parentId: chairMemberId, status: "ACTIVE",
    });

    // Pindah memberNode dari chairMemberId ke divMember.id (parent berubah → non-noop)
    const res = await supertest(app)
      .post(`/api/v1/events/${eventId}/members/${memberNode.id}/move`)
      .set(headers(chair.tokenPlain))
      .send({ newParentId: divMember.id });
    if (res.status !== 200) {
      console.error(
        "OG-GAP3 endpoint=POST /members/:id/move (non-noop) harapan=200 aktual=" +
          res.status +
          " body=" +
          JSON.stringify(res.body),
      );
    }
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.noop).toBe(false);
    expect(res.body.data.member.parentId).toBe(divMember.id);
  });

  it("Leader move anggota dalam subtree ke parent lain dalam subtree → 200 {noop: false}", async () => {
    const chair = await createUserAndSession();
    const { eventId, chairMemberId } = await createEventAndChair(chair.id);

    const leader = await createUserAndSession();
    const leaderMember = await createMember({
      eventId, userId: leader.id, role: "DIVISION_LEADER", parentId: chairMemberId, status: "ACTIVE",
    });

    const child1 = await createUserAndSession();
    const child1Member = await createMember({
      eventId, userId: child1.id, role: "MEMBER", parentId: leaderMember.id, status: "ACTIVE",
    });

    const child2 = await createUserAndSession();
    const child2Member = await createMember({
      eventId, userId: child2.id, role: "MEMBER", parentId: leaderMember.id, status: "ACTIVE",
    });

    // Leader memindahkan child1 dari leaderMember ke child2 (parent berubah, masih dalam subtree)
    const res = await supertest(app)
      .post(`/api/v1/events/${eventId}/members/${child1Member.id}/move`)
      .set(headers(leader.tokenPlain))
      .send({ newParentId: child2Member.id });
    if (res.status !== 200) {
      console.error(
        "OG-GAP4 endpoint=POST /members/:id/move (Leader non-noop) harapan=200 aktual=" +
          res.status +
          " body=" +
          JSON.stringify(res.body),
      );
    }
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.noop).toBe(false);
    expect(res.body.data.member.parentId).toBe(child2Member.id);
  });
});

// ============================================================================
// Organization gap: getSubtree member not found → 404
// ============================================================================
describe("Organization coverage gap: subtree not found", () => {
  it("GET /organization/subtree/:memberId member tidak ada → 404 NOT_FOUND", async () => {
    const chair = await createUserAndSession();
    const { eventId } = await createEventAndChair(chair.id);

    const fakeMemberId = "00000000-0000-0000-0000-000000000000";
    const res = await supertest(app)
      .get(`/api/v1/events/${eventId}/organization/subtree/${fakeMemberId}`)
      .set(headers(chair.tokenPlain));
    if (res.status !== 404) {
      console.error(
        "OG-GAP6 endpoint=GET /organization/subtree/:id (member not found) harapan=404 aktual=" +
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
// Organization gap: PATCH status/role target not found → 404
// ============================================================================
describe("Organization coverage gap: PATCH target not found", () => {
  it("PATCH /members/:memberId/status target tidak ada → 404 NOT_FOUND", async () => {
    const chair = await createUserAndSession();
    const { eventId } = await createEventAndChair(chair.id);

    const fakeMemberId = "00000000-0000-0000-0000-000000000000";
    const res = await supertest(app)
      .patch(`/api/v1/events/${eventId}/members/${fakeMemberId}/status`)
      .set(headers(chair.tokenPlain))
      .set("X-CSRF-Token", sharedCsrf)
      .send({ status: "INACTIVE" });
    if (res.status !== 404) {
      console.error(
        "OG-GAP8 endpoint=PATCH /members/:id/status (target not found) harapan=404 aktual=" +
          res.status +
          " body=" +
          JSON.stringify(res.body),
      );
    }
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });

  it("PATCH /members/:memberId/role target tidak ada → 404 NOT_FOUND", async () => {
    const chair = await createUserAndSession();
    const { eventId } = await createEventAndChair(chair.id);

    const fakeMemberId = "00000000-0000-0000-0000-000000000000";
    const res = await supertest(app)
      .patch(`/api/v1/events/${eventId}/members/${fakeMemberId}/role`)
      .set(headers(chair.tokenPlain))
      .set("X-CSRF-Token", sharedCsrf)
      .send({ role: "MEMBER" });
    if (res.status !== 404) {
      console.error(
        "OG-GAP9 endpoint=PATCH /members/:id/role (target not found) harapan=404 aktual=" +
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
