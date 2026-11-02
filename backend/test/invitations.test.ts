import { hash } from "@node-rs/argon2";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../src/config/database.js";
import { createApp } from "../src/app.ts";
import { hashToken } from "../src/shared/utils/token.js";
import supertest from "supertest";

// ---------------------------------------------------------------------------
// Konfigurasi isolasi DB & rate-limit
// ---------------------------------------------------------------------------
// Semua user/sesi/event/membership dibuat langsung via Prisma (bukan
// /register|/login|/refresh), sehingga kuota credentialRateLimiter TIDAK
// terpakai. Rate-limit publik endpoint /api/v1/invitations/:token (30/menit)
// dihitung dan dipertahankan di bawah 20 total per proses.
//
// DB: test/setup.ts → postgresql://localhost:5433/event_committee_test.
// afterAll membersihkan event (cascade ke event_members + invitations) +
// sessions + users. Jangan hapus data lain.

const app = createApp();
const testUserIds: string[] = [];
const testEventIds: string[] = [];

function email(label: string): string {
  return `inv.${label}.${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
}

function getSetCookieArray(res: supertest.Response): string[] {
  const v = res.headers["set-cookie"];
  if (!v) return [];
  return Array.isArray(v) ? v : [v];
}

function extractCsrfCookie(res: supertest.Response): string | undefined {
  const match = getSetCookieArray(res).find((c) => c.startsWith("ec_csrf="));
  return match ? match.split(";")[0].split("=")[1] : undefined;
}

const ORIGIN = "http://localhost:5173";

// Buat user + session aktif via Prisma. Mengembalikan { id, email, tokenPlain, csrfToken }.
async function createUserAndSession(): Promise<{
  id: string;
  email: string;
  tokenPlain: string;
  csrfToken: string;
}> {
  const e = email("user");
  const passwordHash = await hash("password123");
  const user = await prisma.user.create({ data: { name: "Inv User", email: e, passwordHash } });
  testUserIds.push(user.id);

  const tokenPlain = `tok_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await prisma.session.create({
    data: { userId: user.id, tokenHash: hashToken(tokenPlain), expiresAt, ip: null, userAgent: null },
  });

  const getRes = await supertest(app).get("/api/v1/health").set("Origin", ORIGIN);
  const csrfToken = extractCsrfCookie(getRes);
  if (!csrfToken) throw new Error("ec_csrf tidak tersedia");

  return { id: user.id, email: e, tokenPlain, csrfToken };
}

// Buat event + membership root (EVENT_CHAIR, parentId null) via Prisma.
async function createEventAndChair(
  chairUserId: string,
): Promise<{ eventId: string; chairMemberId: string }> {
  const event = await prisma.event.create({
    data: { name: "Inv Event", slug: `inv-${Date.now()}`, createdById: chairUserId },
  });
  testEventIds.push(event.id);

  const membership = await prisma.eventMember.create({
    data: {
      eventId: event.id,
      userId: chairUserId,
      role: "EVENT_CHAIR",
      parentId: null,
      title: "Ketua",
      status: "ACTIVE",
    },
  });
  return { eventId: event.id, chairMemberId: membership.id };
}

// Buat member non-root dalam event.
async function createMember({
  eventId,
  userId,
  role = "MEMBER",
  parentId,
  status = "ACTIVE",
  title = "Member",
}: {
  eventId: string;
  userId: string;
  role?: "EVENT_CHAIR" | "DIVISION_LEADER" | "MEMBER";
  parentId: string | null;
  status?: "ACTIVE" | "INACTIVE";
  title?: string;
}) {
  return prisma.eventMember.create({
    data: { eventId, userId, role, parentId, title, status },
  });
}

function cookieHeader(tokenPlain: string, csrfToken: string): string {
  return `ec_csrf=${csrfToken}; ec_session=${tokenPlain}`;
}

beforeAll(async () => {
  await prisma.$connect();
});

afterEach(async () => {
  if (testUserIds.length) {
    await prisma.session.deleteMany({ where: { userId: { in: testUserIds } } });
  }
});

afterAll(async () => {
  // Hapus audit_logs untuk event uji SEBELUM event (actor_id RESTRICT pada
  // event_members yang dicascade), lalu sessions + users. Jangan hapus data lain.
  if (testEventIds.length) {
    await prisma.auditLog.deleteMany({
      where: { eventId: { in: testEventIds } },
    });
    await prisma.event.deleteMany({ where: { id: { in: testEventIds } } });
  }
  if (testUserIds.length) {
    await prisma.session.deleteMany({ where: { userId: { in: testUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: testUserIds } } });
  }
  await prisma.$disconnect();
});

describe("T3 Leader undang MEMBER", () => {
  it("T3.1 parent dalam subtree Leader → 201; parent di luar subtree → 403; Leader undang DIVISION_LEADER → 403", async () => {
    const chair = await createUserAndSession();
    const { eventId, chairMemberId } = await createEventAndChair(chair.id);

    const leader = await createUserAndSession();
    const leaderMember = await createMember({
      eventId,
      userId: leader.id,
      role: "DIVISION_LEADER",
      parentId: chairMemberId,
    });

    const inSubtreeChild = await createUserAndSession();
    const inSubtreeMember = await createMember({
      eventId,
      userId: inSubtreeChild.id,
      role: "MEMBER",
      parentId: leaderMember.id,
    });

    const outsideLeader = await createUserAndSession();
    const outsideMember = await createMember({
      eventId,
      userId: outsideLeader.id,
      role: "MEMBER",
      parentId: chairMemberId,
    });

    // Leader undang MEMBER dengan parent dalam subtree → 201
    const ok = await supertest(app)
      .post(`/api/v1/events/${eventId}/invitations`)
      .set("Origin", ORIGIN)
      .set("Cookie", cookieHeader(leader.tokenPlain, leader.csrfToken))
      .set("X-CSRF-Token", leader.csrfToken)
      .send({ email: email("mem"), role: "MEMBER", parentId: inSubtreeMember.id });
    if (ok.status !== 201) {
      console.error(
        "T3.1 GAGAL endpoint=POST /events/:eventId/invitations (in subtree) harapan=201 aktual=" +
          ok.status +
          " body=" +
          JSON.stringify(ok.body),
      );
    }
    expect(ok.status).toBe(201);
    expect(ok.body.success).toBe(true);
    expect(ok.body.data.invitation.parentId).toBe(inSubtreeMember.id);

    // Leader undang MEMBER dengan parent di luar subtree → 403
    const out = await supertest(app)
      .post(`/api/v1/events/${eventId}/invitations`)
      .set("Origin", ORIGIN)
      .set("Cookie", cookieHeader(leader.tokenPlain, leader.csrfToken))
      .set("X-CSRF-Token", leader.csrfToken)
      .send({ email: email("out"), role: "MEMBER", parentId: outsideMember.id });
    if (out.status !== 403) {
      console.error(
        "T3.1 GAGAL endpoint=POST /events/:eventId/invitations (out subtree) harapan=403 aktual=" +
          out.status +
          " body=" +
          JSON.stringify(out.body),
      );
    }
    expect(out.status).toBe(403);
    expect(out.body.error.code).toBe("FORBIDDEN");

    // Leader undang DIVISION_LEADER → 403 (hanya Chair)
    const dl = await supertest(app)
      .post(`/api/v1/events/${eventId}/invitations`)
      .set("Origin", ORIGIN)
      .set("Cookie", cookieHeader(leader.tokenPlain, leader.csrfToken))
      .set("X-CSRF-Token", leader.csrfToken)
      .send({ email: email("dl"), role: "DIVISION_LEADER", parentId: leaderMember.id });
    if (dl.status !== 403) {
      console.error(
        "T3.1 GAGAL endpoint=POST /events/:eventId/invitations (DL role) harapan=403 aktual=" +
          dl.status +
          " body=" +
          JSON.stringify(dl.body),
      );
    }
    expect(dl.status).toBe(403);
    expect(dl.body.error.code).toBe("FORBIDDEN");
  });
});

describe("T4 Member mencoba undang", () => {
  it("T4 MEMBER undang → 403", async () => {
    const chair = await createUserAndSession();
    const { eventId, chairMemberId } = await createEventAndChair(chair.id);

    const member = await createUserAndSession();
    await createMember({
      eventId,
      userId: member.id,
      role: "MEMBER",
      parentId: chairMemberId,
    });

    const res = await supertest(app)
      .post(`/api/v1/events/${eventId}/invitations`)
      .set("Origin", ORIGIN)
      .set("Cookie", cookieHeader(member.tokenPlain, member.csrfToken))
      .set("X-CSRF-Token", member.csrfToken)
      .send({ email: email("x"), role: "MEMBER", parentId: chairMemberId });
    if (res.status !== 403) {
      console.error(
        "T4 GAGAL endpoint=POST /events/:eventId/invitations (member) harapan=403 aktual=" +
          res.status +
          " body=" +
          JSON.stringify(res.body),
      );
    }
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
  });
});

describe("T5 Leader lintas cabang", () => {
  it("T5 PATCH status anggota cabang lain → 403; PATCH role → 403; move anggota cabang lain → 403; move anggota sendiri ke cabang lain → 403", async () => {
    const chair = await createUserAndSession();
    const { eventId, chairMemberId } = await createEventAndChair(chair.id);

    const leader = await createUserAndSession();
    const leaderMember = await createMember({
      eventId,
      userId: leader.id,
      role: "DIVISION_LEADER",
      parentId: chairMemberId,
    });

    const leaderChild = await createUserAndSession();
    const leaderChildMember = await createMember({
      eventId,
      userId: leaderChild.id,
      role: "MEMBER",
      parentId: leaderMember.id,
    });

    const otherLeader = await createUserAndSession();
    const otherLeaderMember = await createMember({
      eventId,
      userId: otherLeader.id,
      role: "DIVISION_LEADER",
      parentId: chairMemberId,
    });

    const otherMember = await createUserAndSession();
    const otherMemberMember = await createMember({
      eventId,
      userId: otherMember.id,
      role: "MEMBER",
      parentId: otherLeaderMember.id,
    });

    // PATCH status anggota cabang lain → 403
    const statusRes = await supertest(app)
      .patch(`/api/v1/events/${eventId}/members/${otherMemberMember.id}/status`)
      .set("Origin", ORIGIN)
      .set("Cookie", cookieHeader(leader.tokenPlain, leader.csrfToken))
      .set("X-CSRF-Token", leader.csrfToken)
      .send({ status: "INACTIVE" });
    if (statusRes.status !== 403) {
      console.error(
        "T5 GAGAL endpoint=PATCH /members/:id/status (cabang lain) harapan=403 aktual=" +
          statusRes.status +
          " body=" +
          JSON.stringify(statusRes.body),
      );
    }
    expect(statusRes.status).toBe(403);
    expect(statusRes.body.error.code).toBe("FORBIDDEN");

    // PATCH role → 403 (hanya Chair)
    const roleRes = await supertest(app)
      .patch(`/api/v1/events/${eventId}/members/${leaderChildMember.id}/role`)
      .set("Origin", ORIGIN)
      .set("Cookie", cookieHeader(leader.tokenPlain, leader.csrfToken))
      .set("X-CSRF-Token", leader.csrfToken)
      .send({ role: "MEMBER" });
    if (roleRes.status !== 403) {
      console.error(
        "T5 GAGAL endpoint=PATCH /members/:id/role (leader) harapan=403 aktual=" +
          roleRes.status +
          " body=" +
          JSON.stringify(roleRes.body),
      );
    }
    expect(roleRes.status).toBe(403);
    expect(roleRes.body.error.code).toBe("FORBIDDEN");

    // Move anggota cabang lain (leaderChild) dengan parent di luar subtree leader → 403
    const moveOut = await supertest(app)
      .post(`/api/v1/events/${eventId}/members/${leaderChildMember.id}/move`)
      .set("Origin", ORIGIN)
      .set("Cookie", cookieHeader(leader.tokenPlain, leader.csrfToken))
      .set("X-CSRF-Token", leader.csrfToken)
      .send({ newParentId: otherMemberMember.id });
    if (moveOut.status !== 403) {
      console.error(
        "T5 GAGAL endpoint=POST /members/:id/move (cabang lain) harapan=403 aktual=" +
          moveOut.status +
          " body=" +
          JSON.stringify(moveOut.body),
      );
    }
    expect(moveOut.status).toBe(403);
    expect(moveOut.body.error.code).toBe("FORBIDDEN");

    // Move anggota sendiri ke cabang lain (parent di luar subtree) → 403
    const moveSelfOut = await supertest(app)
      .post(`/api/v1/events/${eventId}/members/${leaderChildMember.id}/move`)
      .set("Origin", ORIGIN)
      .set("Cookie", cookieHeader(leader.tokenPlain, leader.csrfToken))
      .set("X-CSRF-Token", leader.csrfToken)
      .send({ newParentId: otherLeaderMember.id });
    if (moveSelfOut.status !== 403) {
      console.error(
        "T5 GAGAL endpoint=POST /members/:id/move (sendiri ke cabang lain) harapan=403 aktual=" +
          moveSelfOut.status +
          " body=" +
          JSON.stringify(moveSelfOut.body),
      );
    }
    expect(moveSelfOut.status).toBe(403);
    expect(moveSelfOut.body.error.code).toBe("FORBIDDEN");
  });
});

describe("T12 sekali pakai (token)", () => {
  it("T12.1 create → GET publik 200 tanpa email; accept email beda → 403; accept user diundang → 201 + membership di GET /organization; accept kedua → 410; count membership tetap 1", async () => {
    const chair = await createUserAndSession();
    const { eventId, chairMemberId } = await createEventAndChair(chair.id);

    const invitee = await createUserAndSession();
    const inviteeEmail = invitee.email;

    const res = await supertest(app)
      .post(`/api/v1/events/${eventId}/invitations`)
      .set("Origin", ORIGIN)
      .set("Cookie", cookieHeader(chair.tokenPlain, chair.csrfToken))
      .set("X-CSRF-Token", chair.csrfToken)
      .send({ email: inviteeEmail, role: "MEMBER", parentId: chairMemberId });
    if (res.status !== 201) {
      console.error(
        "T12.1 GAGAL endpoint=POST /events/:eventId/invitations harapan=201 aktual=" +
          res.status +
          " body=" +
          JSON.stringify(res.body),
      );
    }
    expect(res.status).toBe(201);
    const token = res.body.data.token;
    const invitationId = res.body.data.invitation.id;

    // GET publik 200, TANPA email
    const pub = await supertest(app).get(`/api/v1/invitations/${token}`);
    if (pub.status !== 200) {
      console.error(
        "T12.1 GAGAL endpoint=GET /invitations/:token harapan=200 aktual=" +
          pub.status +
          " body=" +
          JSON.stringify(pub.body),
      );
    }
    expect(pub.status).toBe(200);
    expect(pub.body.success).toBe(true);
    expect(pub.body.data.eventName).toBeDefined();
    expect(pub.body.data.eventSlug).toBeDefined();
    expect(pub.body.data.eventStatus).toBe("OPEN");
    expect(pub.body.data.role).toBe("MEMBER");
    expect(pub.body.data.expiresAt).toBeDefined();
    expect(pub.body.data.email).toBeUndefined();
    expect(JSON.stringify(pub.body)).not.toContain("email");

    // Accept oleh user email berbeda → 403
    const wrong = await createUserAndSession();
    const wrongAccept = await supertest(app)
      .post(`/api/v1/invitations/${token}/accept`)
      .set("Origin", ORIGIN)
      .set("Cookie", cookieHeader(wrong.tokenPlain, wrong.csrfToken))
      .set("X-CSRF-Token", wrong.csrfToken);
    if (wrongAccept.status !== 403) {
      console.error(
        "T12.1 GAGAL endpoint=POST /invitations/:token/accept (email beda) harapan=403 aktual=" +
          wrongAccept.status +
          " body=" +
          JSON.stringify(wrongAccept.body),
      );
    }
    expect(wrongAccept.status).toBe(403);
    expect(wrongAccept.body.error.code).toBe("FORBIDDEN");

    // Accept oleh user yang diundang → 201
    const acc = await supertest(app)
      .post(`/api/v1/invitations/${token}/accept`)
      .set("Origin", ORIGIN)
      .set("Cookie", cookieHeader(invitee.tokenPlain, invitee.csrfToken))
      .set("X-CSRF-Token", invitee.csrfToken);
    if (acc.status !== 201) {
      console.error(
        "T12.1 GAGAL endpoint=POST /invitations/:token/accept harapan=201 aktual=" +
          acc.status +
          " body=" +
          JSON.stringify(acc.body),
      );
    }
    expect(acc.status).toBe(201);
    expect(acc.body.success).toBe(true);
    const membershipId = acc.body.data.membership.id;
    expect(acc.body.data.membership.userId).toBe(invitee.id);
    expect(acc.body.data.membership.eventId).toBe(eventId);
    expect(acc.body.data.membership.status).toBe("ACTIVE");
    expect(acc.body.data.membership.role).toBe("MEMBER");
    expect(acc.body.data.membership.parentId).toBe(chairMemberId);

    // Membership muncul di GET /organization (node berid membershipId)
    const org = await supertest(app)
      .get(`/api/v1/events/${eventId}/organization`)
      .set("Origin", ORIGIN)
      .set("Cookie", cookieHeader(chair.tokenPlain, chair.csrfToken));
    if (org.status !== 200) {
      console.error(
        "T12.1 GAGAL endpoint=GET /organization harapan=200 aktual=" +
          org.status +
          " body=" +
          JSON.stringify(org.body),
      );
    }
    expect(org.status).toBe(200);
    expect(org.body.data.nodes.some((n: { id: string }) => n.id === membershipId)).toBe(true);

    // Accept kedua → 410
    const acc2 = await supertest(app)
      .post(`/api/v1/invitations/${token}/accept`)
      .set("Origin", ORIGIN)
      .set("Cookie", cookieHeader(invitee.tokenPlain, invitee.csrfToken))
      .set("X-CSRF-Token", invitee.csrfToken);
    if (acc2.status !== 410) {
      console.error(
        "T12.1 GAGAL endpoint=POST /invitations/:token/accept (kedua) harapan=410 aktual=" +
          acc2.status +
          " body=" +
          JSON.stringify(acc2.body),
      );
    }
    expect(acc2.status).toBe(410);
    expect(acc2.body.error.code).toBe("GONE");

    // Count membership (userId, eventId) tetap 1
    const count = await prisma.eventMember.count({
      where: { eventId, userId: invitee.id },
    });
    expect(count).toBe(1);

    // Undangan di DB berstatus ACCEPTED
    const dbInv = await prisma.invitation.findUnique({ where: { id: invitationId } });
    expect(dbInv!.status).toBe("ACCEPTED");
  });

  it("T12.2 revoke undangan PENDING lalu accept → 410", async () => {
    const chair = await createUserAndSession();
    const { eventId, chairMemberId } = await createEventAndChair(chair.id);

    const invitee = await createUserAndSession();
    const res = await supertest(app)
      .post(`/api/v1/events/${eventId}/invitations`)
      .set("Origin", ORIGIN)
      .set("Cookie", cookieHeader(chair.tokenPlain, chair.csrfToken))
      .set("X-CSRF-Token", chair.csrfToken)
      .send({ email: invitee.email, role: "MEMBER", parentId: chairMemberId });
    expect(res.status).toBe(201);
    const token = res.body.data.token;
    const invitationId = res.body.data.invitation.id;

    // Revoke (chair boleh semua PENDING)
    const rev = await supertest(app)
      .post(`/api/v1/events/${eventId}/invitations/${invitationId}/revoke`)
      .set("Origin", ORIGIN)
      .set("Cookie", cookieHeader(chair.tokenPlain, chair.csrfToken))
      .set("X-CSRF-Token", chair.csrfToken);
    if (rev.status !== 200) {
      console.error(
        "T12.2 GAGAL endpoint=POST /events/:eventId/invitations/:id/revoke harapan=200 aktual=" +
          rev.status +
          " body=" +
          JSON.stringify(rev.body),
      );
    }
    expect(rev.status).toBe(200);
    expect(rev.body.data.status).toBe("REVOKED");

    // Accept setelah revoke → 410
    const acc = await supertest(app)
      .post(`/api/v1/invitations/${token}/accept`)
      .set("Origin", ORIGIN)
      .set("Cookie", cookieHeader(invitee.tokenPlain, invitee.csrfToken))
      .set("X-CSRF-Token", invitee.csrfToken);
    if (acc.status !== 410) {
      console.error(
        "T12.2 GAGAL endpoint=POST /invitations/:token/accept (revoked) harapan=410 aktual=" +
          acc.status +
          " body=" +
          JSON.stringify(acc.body),
      );
    }
    expect(acc.status).toBe(410);
    expect(acc.body.error.code).toBe("GONE");
  });

  it("T12.3 expiresAt masa lalu → GET publik 410 dan accept 410", async () => {
    const chair = await createUserAndSession();
    const { eventId, chairMemberId } = await createEventAndChair(chair.id);

    const invitee = await createUserAndSession();
    const res = await supertest(app)
      .post(`/api/v1/events/${eventId}/invitations`)
      .set("Origin", ORIGIN)
      .set("Cookie", cookieHeader(chair.tokenPlain, chair.csrfToken))
      .set("X-CSRF-Token", chair.csrfToken)
      .send({ email: invitee.email, role: "MEMBER", parentId: chairMemberId });
    expect(res.status).toBe(201);
    const token = res.body.data.token;
    const invitationId = res.body.data.invitation.id;

    // Set expiresAt ke masa lalu via Prisma
    await prisma.invitation.update({
      where: { id: invitationId },
      data: { expiresAt: new Date(Date.now() - 60 * 60 * 1000) },
    });

    // GET publik 410
    const pub = await supertest(app).get(`/api/v1/invitations/${token}`);
    if (pub.status !== 410) {
      console.error(
        "T12.3 GAGAL endpoint=GET /invitations/:token (expired) harapan=410 aktual=" +
          pub.status +
          " body=" +
          JSON.stringify(pub.body),
      );
    }
    expect(pub.status).toBe(410);
    expect(pub.body.error.code).toBe("GONE");

    // Accept → 410
    const acc = await supertest(app)
      .post(`/api/v1/invitations/${token}/accept`)
      .set("Origin", ORIGIN)
      .set("Cookie", cookieHeader(invitee.tokenPlain, invitee.csrfToken))
      .set("X-CSRF-Token", invitee.csrfToken);
    if (acc.status !== 410) {
      console.error(
        "T12.3 GAGAL endpoint=POST /invitations/:token/accept (expired) harapan=410 aktual=" +
          acc.status +
          " body=" +
          JSON.stringify(acc.body),
      );
    }
    expect(acc.status).toBe(410);
    expect(acc.body.error.code).toBe("GONE");
  });
});

describe("T2 Chair undang DIVISION_LEADER", () => {
  it("T2.1 201; token ada; token_hash === sha256(token) dan !== token; parentId/invitedById = chair member; GET list PENDING tanpa tokenHash", async () => {
    const chair = await createUserAndSession();
    const { eventId, chairMemberId } = await createEventAndChair(chair.id);

    const dlEmail = email("dl");
    const res = await supertest(app)
      .post(`/api/v1/events/${eventId}/invitations`)
      .set("Origin", ORIGIN)
      .set("Cookie", cookieHeader(chair.tokenPlain, chair.csrfToken))
      .set("X-CSRF-Token", chair.csrfToken)
      .send({ email: dlEmail, role: "DIVISION_LEADER", parentId: chairMemberId });

    if (res.status !== 201) {
      console.error(
        "T2.1 GAGAL endpoint=POST /events/:eventId/invitations harapan=201 aktual=" +
          res.status +
          " body=" +
          JSON.stringify(res.body),
      );
    }
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.token).toBeDefined();
    expect(typeof res.body.data.token).toBe("string");
    expect(res.body.data.token.length).toBeGreaterThan(0);

    const inv = res.body.data.invitation;
    expect(inv.eventId).toBe(eventId);
    expect(inv.email).toBe(dlEmail);
    expect(inv.role).toBe("DIVISION_LEADER");
    expect(inv.status).toBe("PENDING");
    expect(inv.parentId).toBe(chairMemberId);
    expect(inv.invitedById).toBe(chairMemberId);
    expect(inv.expiresAt).toBeDefined();
    expect(inv.createdAt).toBeDefined();

    // DB verifikasi token_hash
    const dbInv = await prisma.invitation.findUnique({ where: { id: inv.id } });
    if (!dbInv) throw new Error("invitation tidak ada di DB");
    expect(dbInv.tokenHash).toBe(hashToken(res.body.data.token));
    expect(dbInv.tokenHash).not.toBe(res.body.data.token);
    expect(dbInv.tokenHash).not.toBe(dbInv.id);
    expect(dbInv.status).toBe("PENDING");

    // GET list memuat PENDING tanpa token/tokenHash
    const listRes = await supertest(app)
      .get(`/api/v1/events/${eventId}/invitations?status=PENDING`)
      .set("Origin", ORIGIN)
      .set("Cookie", cookieHeader(chair.tokenPlain, chair.csrfToken))
      .set("X-CSRF-Token", chair.csrfToken);
    if (listRes.status !== 200) {
      console.error(
        "T2.1 GAGAL endpoint=GET /events/:eventId/invitations harapan=200 aktual=" +
          listRes.status +
          " body=" +
          JSON.stringify(listRes.body),
      );
    }
    expect(listRes.status).toBe(200);
    expect(listRes.body.success).toBe(true);
    const item = listRes.body.data.items.find((i: { id: string }) => i.id === inv.id);
    expect(item).toBeDefined();
    expect(item.token).toBeUndefined();
    expect(item.tokenHash).toBeUndefined();
  });
});

describe("T13 struktur (move)", () => {
  it("T13 rantai chair→A→B→C; move A di bawah C → 422 (cycle); move B ke dirinya sendiri → 422; move root chair → 422; move A parentId event lain → 404/422", async () => {
    const chair = await createUserAndSession();
    const { eventId, chairMemberId } = await createEventAndChair(chair.id);

    const aUser = await createUserAndSession();
    const aNode = await createMember({ eventId, userId: aUser.id, role: "MEMBER", parentId: chairMemberId });
    const bUser = await createUserAndSession();
    const bNode = await createMember({ eventId, userId: bUser.id, role: "MEMBER", parentId: aNode.id });
    const cUser = await createUserAndSession();
    const cNode = await createMember({ eventId, userId: cUser.id, role: "MEMBER", parentId: bNode.id });

    // Move A di bawah C (C adalah keturunan A) → cycle → 422
    const cycle = await supertest(app)
      .post(`/api/v1/events/${eventId}/members/${aNode.id}/move`)
      .set("Origin", ORIGIN)
      .set("Cookie", cookieHeader(chair.tokenPlain, chair.csrfToken))
      .set("X-CSRF-Token", chair.csrfToken)
      .send({ newParentId: cNode.id });
    if (cycle.status !== 422) {
      console.error(
        "T13 GAGAL endpoint=POST /members/:id/move (cycle) harapan=422 aktual=" +
          cycle.status +
          " body=" +
          JSON.stringify(cycle.body),
      );
    }
    expect(cycle.status).toBe(422);
    expect(cycle.body.error.code).toBe("UNPROCESSABLE");

    // Move B ke dirinya sendiri → 422
    const self = await supertest(app)
      .post(`/api/v1/events/${eventId}/members/${bNode.id}/move`)
      .set("Origin", ORIGIN)
      .set("Cookie", cookieHeader(chair.tokenPlain, chair.csrfToken))
      .set("X-CSRF-Token", chair.csrfToken)
      .send({ newParentId: bNode.id });
    if (self.status !== 422) {
      console.error(
        "T13 GAGAL endpoint=POST /members/:id/move (self) harapan=422 aktual=" +
          self.status +
          " body=" +
          JSON.stringify(self.body),
      );
    }
    expect(self.status).toBe(422);
    expect(self.body.error.code).toBe("UNPROCESSABLE");

    // Move root chair → 422
    const rootMove = await supertest(app)
      .post(`/api/v1/events/${eventId}/members/${chairMemberId}/move`)
      .set("Origin", ORIGIN)
      .set("Cookie", cookieHeader(chair.tokenPlain, chair.csrfToken))
      .set("X-CSRF-Token", chair.csrfToken)
      .send({ newParentId: aNode.id });
    if (rootMove.status !== 422) {
      console.error(
        "T13 GAGAL endpoint=POST /members/:id/move (root) harapan=422 aktual=" +
          rootMove.status +
          " body=" +
          JSON.stringify(rootMove.body),
      );
    }
    expect(rootMove.status).toBe(422);
    expect(rootMove.body.error.code).toBe("UNPROCESSABLE");

    // Event lain + anggota di event lain
    const otherChair = await createUserAndSession();
    const { eventId: otherEventId } = await createEventAndChair(otherChair.id);
    const otherUser = await createUserAndSession();
    const otherMember = await createMember({
      eventId: otherEventId,
      userId: otherUser.id,
      role: "MEMBER",
      parentId: (await prisma.eventMember.findFirst({
        where: { eventId: otherEventId, role: "EVENT_CHAIR" },
      }))!.id,
    });

    // Move A dengan parentId dari event lain → 404/422
    const cross = await supertest(app)
      .post(`/api/v1/events/${eventId}/members/${aNode.id}/move`)
      .set("Origin", ORIGIN)
      .set("Cookie", cookieHeader(chair.tokenPlain, chair.csrfToken))
      .set("X-CSRF-Token", chair.csrfToken)
      .send({ newParentId: otherMember.id });
    if (cross.status !== 404 && cross.status !== 422) {
      console.error(
        "T13 GAGAL endpoint=POST /members/:id/move (cross-event) harapan=404/422 aktual=" +
          cross.status +
          " body=" +
          JSON.stringify(cross.body),
      );
    }
    expect([404, 422]).toContain(cross.status);
  });
});

describe("Additional: duplikasi & event CLOSED", () => {
  it("undang email yang sudah anggota ACTIVE → 409; undang email sama saat PENDING → 409", async () => {
    const chair = await createUserAndSession();
    const { eventId, chairMemberId } = await createEventAndChair(chair.id);

    const existing = await createUserAndSession();
    await createMember({ eventId, userId: existing.id, role: "MEMBER", parentId: chairMemberId, status: "ACTIVE" });

    // Email sudah anggota ACTIVE → 409
    const active = await supertest(app)
      .post(`/api/v1/events/${eventId}/invitations`)
      .set("Origin", ORIGIN)
      .set("Cookie", cookieHeader(chair.tokenPlain, chair.csrfToken))
      .set("X-CSRF-Token", chair.csrfToken)
      .send({ email: existing.email, role: "MEMBER", parentId: chairMemberId });
    if (active.status !== 409) {
      console.error(
        "Additional GAGAL endpoint=POST /invitations (email aktif) harapan=409 aktual=" +
          active.status +
          " body=" +
          JSON.stringify(active.body),
      );
    }
    expect(active.status).toBe(409);
    expect(active.body.error.code).toBe("CONFLICT");

    // Undang email sama saat PENDING → 409 (partial unique index)
    const pend = await supertest(app)
      .post(`/api/v1/events/${eventId}/invitations`)
      .set("Origin", ORIGIN)
      .set("Cookie", cookieHeader(chair.tokenPlain, chair.csrfToken))
      .set("X-CSRF-Token", chair.csrfToken)
      .send({ email: email("pend"), role: "MEMBER", parentId: chairMemberId });
    expect(pend.status).toBe(201);
    const pendAgain = await supertest(app)
      .post(`/api/v1/events/${eventId}/invitations`)
      .set("Origin", ORIGIN)
      .set("Cookie", cookieHeader(chair.tokenPlain, chair.csrfToken))
      .set("X-CSRF-Token", chair.csrfToken)
      .send({ email: pend.body.data.invitation.email, role: "MEMBER", parentId: chairMemberId });
    if (pendAgain.status !== 409) {
      console.error(
        "Additional GAGAL endpoint=POST /invitations (pending duplikat) harapan=409 aktual=" +
          pendAgain.status +
          " body=" +
          JSON.stringify(pendAgain.body),
      );
    }
    expect(pendAgain.status).toBe(409);
    expect(pendAgain.body.error.code).toBe("CONFLICT");
  });

  it("event CLOSED: create undangan → 409; accept undangan yang dibuat sebelum close → 409", async () => {
    const chair = await createUserAndSession();
    const { eventId, chairMemberId } = await createEventAndChair(chair.id);

    const invitee = await createUserAndSession();
    const res = await supertest(app)
      .post(`/api/v1/events/${eventId}/invitations`)
      .set("Origin", ORIGIN)
      .set("Cookie", cookieHeader(chair.tokenPlain, chair.csrfToken))
      .set("X-CSRF-Token", chair.csrfToken)
      .send({ email: invitee.email, role: "MEMBER", parentId: chairMemberId });
    expect(res.status).toBe(201);
    const token = res.body.data.token;

    // Close event (chair)
    const close = await supertest(app)
      .post(`/api/v1/events/${eventId}/close`)
      .set("Origin", ORIGIN)
      .set("Cookie", cookieHeader(chair.tokenPlain, chair.csrfToken))
      .set("X-CSRF-Token", chair.csrfToken)
      .send({ confirm: true });
    if (close.status !== 200) {
      console.error(
        "Additional GAGAL endpoint=POST /events/:id/close harapan=200 aktual=" +
          close.status +
          " body=" +
          JSON.stringify(close.body),
      );
    }
    expect(close.status).toBe(200);

    // Create undangan pada event CLOSED → 409
    const createClosed = await supertest(app)
      .post(`/api/v1/events/${eventId}/invitations`)
      .set("Origin", ORIGIN)
      .set("Cookie", cookieHeader(chair.tokenPlain, chair.csrfToken))
      .set("X-CSRF-Token", chair.csrfToken)
      .send({ email: email("closed"), role: "MEMBER", parentId: chairMemberId });
    if (createClosed.status !== 409) {
      console.error(
        "Additional GAGAL endpoint=POST /invitations (event closed) harapan=409 aktual=" +
          createClosed.status +
          " body=" +
          JSON.stringify(createClosed.body),
      );
    }
    expect(createClosed.status).toBe(409);
    expect(createClosed.body.error.code).toBe("CONFLICT");

    // Accept undangan yang dibuat sebelum close → 409
    const acc = await supertest(app)
      .post(`/api/v1/invitations/${token}/accept`)
      .set("Origin", ORIGIN)
      .set("Cookie", cookieHeader(invitee.tokenPlain, invitee.csrfToken))
      .set("X-CSRF-Token", invitee.csrfToken);
    if (acc.status !== 409) {
      console.error(
        "Additional GAGAL endpoint=POST /invitations/:token/accept (event closed) harapan=409 aktual=" +
          acc.status +
          " body=" +
          JSON.stringify(acc.body),
      );
    }
    expect(acc.status).toBe(409);
    expect(acc.body.error.code).toBe("CONFLICT");
  });
});

describe("Konkurensi", () => {
  it("K1 accept ganda paralel: tepat satu 201 + satu 410; membership = 1; status ACCEPTED", async () => {
    const chair = await createUserAndSession();
    const { eventId, chairMemberId } = await createEventAndChair(chair.id);
    const invitee = await createUserAndSession();

    const createRes = await supertest(app)
      .post(`/api/v1/events/${eventId}/invitations`)
      .set("Origin", ORIGIN)
      .set("Cookie", cookieHeader(chair.tokenPlain, chair.csrfToken))
      .set("X-CSRF-Token", chair.csrfToken)
      .send({ email: invitee.email, role: "MEMBER", parentId: chairMemberId });
    if (createRes.status !== 201) {
      console.error(
        "K1 GAGAL endpoint=POST /events/:eventId/invitations harapan=201 aktual=" +
          createRes.status +
          " body=" +
          JSON.stringify(createRes.body),
      );
    }
    expect(createRes.status).toBe(201);
    const token = createRes.body.data.token;

    const results = await Promise.all([
      supertest(app)
        .post(`/api/v1/invitations/${token}/accept`)
        .set("Origin", ORIGIN)
        .set("Cookie", cookieHeader(invitee.tokenPlain, invitee.csrfToken))
        .set("X-CSRF-Token", invitee.csrfToken),
      supertest(app)
        .post(`/api/v1/invitations/${token}/accept`)
        .set("Origin", ORIGIN)
        .set("Cookie", cookieHeader(invitee.tokenPlain, invitee.csrfToken))
        .set("X-CSRF-Token", invitee.csrfToken),
    ]);

    const statuses = results.map((r) => r.status);
    expect(statuses.filter((s) => s === 201).length).toBe(1);
    expect(statuses.filter((s) => s === 410).length).toBe(1);

    const count = await prisma.eventMember.count({
      where: { eventId, userId: invitee.id },
    });
    expect(count).toBe(1);

    const dbInv = await prisma.invitation.findFirst({
      where: { eventId, email: invitee.email, status: "ACCEPTED" },
    });
    expect(dbInv).toBeDefined();
  });

  it("K2 accept vs revoke paralel: salah satu sukses, tidak keduanya", async () => {
    const chair = await createUserAndSession();
    const { eventId, chairMemberId } = await createEventAndChair(chair.id);
    const invitee = await createUserAndSession();

    const createRes = await supertest(app)
      .post(`/api/v1/events/${eventId}/invitations`)
      .set("Origin", ORIGIN)
      .set("Cookie", cookieHeader(chair.tokenPlain, chair.csrfToken))
      .set("X-CSRF-Token", chair.csrfToken)
      .send({ email: invitee.email, role: "MEMBER", parentId: chairMemberId });
    if (createRes.status !== 201) {
      console.error(
        "K2 GAGAL endpoint=POST /events/:eventId/invitations harapan=201 aktual=" +
          createRes.status +
          " body=" +
          JSON.stringify(createRes.body),
      );
    }
    expect(createRes.status).toBe(201);
    const token = createRes.body.data.token;
    const invitationId = createRes.body.data.invitation.id;

    const results = await Promise.all([
      supertest(app)
        .post(`/api/v1/invitations/${token}/accept`)
        .set("Origin", ORIGIN)
        .set("Cookie", cookieHeader(invitee.tokenPlain, invitee.csrfToken))
        .set("X-CSRF-Token", invitee.csrfToken),
      supertest(app)
        .post(`/api/v1/events/${eventId}/invitations/${invitationId}/revoke`)
        .set("Origin", ORIGIN)
        .set("Cookie", cookieHeader(chair.tokenPlain, chair.csrfToken))
        .set("X-CSRF-Token", chair.csrfToken),
    ]);

    const acceptStatus = results[0].status;
    const revokeStatus = results[1].status;

    // Tidak boleh keduanya sukses (accept 201 dan revoke 200)
    expect(acceptStatus === 201 && revokeStatus === 200).toBe(false);
    // Hanya salah satu dari: (accept 201 & revoke 409) atau (accept 410 & revoke 200)
    expect(
      (acceptStatus === 201 && revokeStatus === 409) ||
        (acceptStatus === 410 && revokeStatus === 200),
    ).toBe(true);

    const membershipCount = await prisma.eventMember.count({
      where: { eventId, userId: invitee.id },
    });
    const dbInv = await prisma.invitation.findUnique({ where: { id: invitationId } });
    if (!dbInv) throw new Error("invitation tidak ada di DB");
    if (membershipCount === 1) {
      expect(dbInv.status).toBe("ACCEPTED");
    } else {
      expect(membershipCount).toBe(0);
      expect(dbInv.status).toBe("REVOKED");
    }
  });

  it("K3 accept vs close event paralel: close 200; accept 201 atau 409; konsistensi membership", async () => {
    const chair = await createUserAndSession();
    const { eventId, chairMemberId } = await createEventAndChair(chair.id);
    const invitee = await createUserAndSession();

    const createRes = await supertest(app)
      .post(`/api/v1/events/${eventId}/invitations`)
      .set("Origin", ORIGIN)
      .set("Cookie", cookieHeader(chair.tokenPlain, chair.csrfToken))
      .set("X-CSRF-Token", chair.csrfToken)
      .send({ email: invitee.email, role: "MEMBER", parentId: chairMemberId });
    if (createRes.status !== 201) {
      console.error(
        "K3 GAGAL endpoint=POST /events/:eventId/invitations harapan=201 aktual=" +
          createRes.status +
          " body=" +
          JSON.stringify(createRes.body),
      );
    }
    expect(createRes.status).toBe(201);
    const token = createRes.body.data.token;

    const results = await Promise.all([
      supertest(app)
        .post(`/api/v1/invitations/${token}/accept`)
        .set("Origin", ORIGIN)
        .set("Cookie", cookieHeader(invitee.tokenPlain, invitee.csrfToken))
        .set("X-CSRF-Token", invitee.csrfToken),
      supertest(app)
        .post(`/api/v1/events/${eventId}/close`)
        .set("Origin", ORIGIN)
        .set("Cookie", cookieHeader(chair.tokenPlain, chair.csrfToken))
        .set("X-CSRF-Token", chair.csrfToken)
        .send({ confirm: true }),
    ]);

    const acceptStatus = results[0].status;
    const closeStatus = results[1].status;

    if (closeStatus !== 200) {
      console.error(
        "K3 GAGAL endpoint=POST /events/:id/close harapan=200 aktual=" +
          closeStatus +
          " body=" +
          JSON.stringify(results[1].body),
      );
    }
    expect(closeStatus).toBe(200);
    expect([201, 409]).toContain(acceptStatus);

    const membershipCount = await prisma.eventMember.count({
      where: { eventId, userId: invitee.id },
    });
    if (acceptStatus === 201) {
      expect(membershipCount).toBe(1);
    } else {
      expect(membershipCount).toBe(0);
    }

    const eventAfter = await prisma.event.findUnique({ where: { id: eventId } });
    if (!eventAfter) throw new Error("event tidak ada di DB");
    expect(eventAfter.status).toBe("CLOSED");
  });

  it("K4 create invitation vs close event paralel: close 200; create 201 atau 409; tidak ada undangan setelah close", async () => {
    const chair = await createUserAndSession();
    const { eventId, chairMemberId } = await createEventAndChair(chair.id);
    const invitee = await createUserAndSession();

    const results = await Promise.all([
      supertest(app)
        .post(`/api/v1/events/${eventId}/invitations`)
        .set("Origin", ORIGIN)
        .set("Cookie", cookieHeader(chair.tokenPlain, chair.csrfToken))
        .set("X-CSRF-Token", chair.csrfToken)
        .send({ email: invitee.email, role: "MEMBER", parentId: chairMemberId }),
      supertest(app)
        .post(`/api/v1/events/${eventId}/close`)
        .set("Origin", ORIGIN)
        .set("Cookie", cookieHeader(chair.tokenPlain, chair.csrfToken))
        .set("X-CSRF-Token", chair.csrfToken)
        .send({ confirm: true }),
    ]);

    const createStatus = results[0].status;
    const closeStatus = results[1].status;

    if (closeStatus !== 200) {
      console.error(
        "K4 GAGAL endpoint=POST /events/:id/close harapan=200 aktual=" +
          closeStatus +
          " body=" +
          JSON.stringify(results[1].body),
      );
    }
    expect(closeStatus).toBe(200);
    expect([201, 409]).toContain(createStatus);

    const invitationCount = await prisma.invitation.count({
      where: { eventId, email: invitee.email },
    });
    if (createStatus === 201) {
      expect(invitationCount).toBe(1);
      const dbInv = await prisma.invitation.findFirst({
        where: { eventId, email: invitee.email },
      });
      if (!dbInv) throw new Error("invitation tidak ada di DB");
      expect(dbInv.status).toBe("PENDING");
    } else {
      expect(invitationCount).toBe(0);
    }

    const eventAfter = await prisma.event.findUnique({ where: { id: eventId } });
    if (!eventAfter) throw new Error("event tidak ada di DB");
    expect(eventAfter.status).toBe("CLOSED");
  });

  it("K5 accept vs nonaktifkan inviter/parent paralel: patch 200; accept 201/409/410; konsistensi", async () => {
    const chair = await createUserAndSession();
    const { eventId, chairMemberId } = await createEventAndChair(chair.id);

    const leader = await createUserAndSession();
    const leaderMember = await createMember({
      eventId,
      userId: leader.id,
      role: "DIVISION_LEADER",
      parentId: chairMemberId,
    });

    const invitee = await createUserAndSession();

    const createRes = await supertest(app)
      .post(`/api/v1/events/${eventId}/invitations`)
      .set("Origin", ORIGIN)
      .set("Cookie", cookieHeader(leader.tokenPlain, leader.csrfToken))
      .set("X-CSRF-Token", leader.csrfToken)
      .send({ email: invitee.email, role: "MEMBER", parentId: leaderMember.id });
    if (createRes.status !== 201) {
      console.error(
        "K5 GAGAL endpoint=POST /events/:eventId/invitations harapan=201 aktual=" +
          createRes.status +
          " body=" +
          JSON.stringify(createRes.body),
      );
    }
    expect(createRes.status).toBe(201);
    const token = createRes.body.data.token;

    const results = await Promise.all([
      supertest(app)
        .post(`/api/v1/invitations/${token}/accept`)
        .set("Origin", ORIGIN)
        .set("Cookie", cookieHeader(invitee.tokenPlain, invitee.csrfToken))
        .set("X-CSRF-Token", invitee.csrfToken),
      supertest(app)
        .patch(`/api/v1/events/${eventId}/members/${leaderMember.id}/status`)
        .set("Origin", ORIGIN)
        .set("Cookie", cookieHeader(chair.tokenPlain, chair.csrfToken))
        .set("X-CSRF-Token", chair.csrfToken)
        .send({ status: "INACTIVE" }),
    ]);

    const acceptStatus = results[0].status;
    const patchStatus = results[1].status;

    if (patchStatus !== 200) {
      console.error(
        "K5 GAGAL endpoint=PATCH /members/:id/status harapan=200 aktual=" +
          patchStatus +
          " body=" +
          JSON.stringify(results[1].body),
      );
    }
    expect(patchStatus).toBe(200);
    expect([201, 409, 410]).toContain(acceptStatus);

    const membershipCount = await prisma.eventMember.count({
      where: { eventId, userId: invitee.id },
    });
    if (acceptStatus === 201) {
      expect(membershipCount).toBe(1);
    } else {
      expect(membershipCount).toBe(0);
    }
  });
});
