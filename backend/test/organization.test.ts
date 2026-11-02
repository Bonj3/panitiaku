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
// /register|/login|/refresh), sehingga kuota credentialRateLimiter (10/menit
// per proses) TIDAK terpakai. Tidak ada pemanggilan endpoint kredensial.
//
// DB: test/setup.ts → postgresql://localhost:5433/event_committee_test.
// afterAll membersihkan event (cascade ke event_members) + sessions + users.

const app = createApp();
const testUserIds: string[] = [];
const testEventIds: string[] = [];

function email(label: string): string {
  return `org.${label}.${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
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

// Buat user + session aktif via Prisma. Mengembalikan { id, tokenPlain, csrfToken }.
async function createUserAndSession(): Promise<{
  id: string;
  tokenPlain: string;
  csrfToken: string;
}> {
  const e = email("user");
  const passwordHash = await hash("password123");
  const user = await prisma.user.create({
    data: { name: "Org User", email: e, passwordHash },
  });
  testUserIds.push(user.id);

  const tokenPlain = `tok_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await prisma.session.create({
    data: { userId: user.id, tokenHash: hashToken(tokenPlain), expiresAt, ip: null, userAgent: null },
  });

  const getRes = await supertest(app).get("/api/v1/health").set("Origin", ORIGIN);
  const csrfToken = extractCsrfCookie(getRes);
  if (!csrfToken) throw new Error("ec_csrf tidak tersedia");

  return { id: user.id, tokenPlain, csrfToken };
}

// Buat event + membership root (EVENT_CHAIR, parentId null) via Prisma.
async function createEventAndChair(
  chairUserId: string,
): Promise<{ eventId: string; chairMemberId: string }> {
  const event = await prisma.event.create({
    data: { name: "Org Event", slug: `org-${Date.now()}`, createdById: chairUserId },
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
  // event_members yang dicascade), lalu sessions + users.
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

describe("Organization tree", () => {
  it("T-O1 GET /organization → root/nodes/edges konsisten, edges source/target valid", async () => {
    const chair = await createUserAndSession();
    const { eventId, chairMemberId } = await createEventAndChair(chair.id);

    const div = await createUserAndSession();
    const divMember = await createMember({
      eventId,
      userId: div.id,
      role: "DIVISION_LEADER",
      parentId: chairMemberId,
    });

    const mem = await createUserAndSession();
    await createMember({
      eventId,
      userId: mem.id,
      role: "MEMBER",
      parentId: divMember.id,
    });

    const res = await supertest(app)
      .get(`/api/v1/events/${eventId}/organization`)
      .set("Origin", ORIGIN)
      .set("Cookie", cookieHeader(chair.tokenPlain, chair.csrfToken));

    if (res.status !== 200) {
      console.error(
        "T-O1 GAGAL endpoint=GET /organization harapan=200 aktual=" +
          res.status +
          " body=" +
          JSON.stringify(res.body),
      );
    }
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.root).toBe(chairMemberId);
    expect(Array.isArray(res.body.data.nodes)).toBe(true);
    expect(Array.isArray(res.body.data.edges)).toBe(true);

    const nodeIds = new Set(res.body.data.nodes.map((n: { id: string }) => n.id));
    expect(nodeIds.has(chairMemberId)).toBe(true);
    expect(nodeIds.has(divMember.id)).toBe(true);

    for (const edge of res.body.data.edges) {
      expect(nodeIds.has(edge.source)).toBe(true);
      expect(nodeIds.has(edge.target)).toBe(true);
    }
  });

  it("T-O2 GET /members filter q + role + pagination", async () => {
    const chair = await createUserAndSession();
    const { eventId, chairMemberId } = await createEventAndChair(chair.id);

    // CHECK chair_is_root: non-CHAIR wajib punya parent.
    await createMember({
      eventId,
      userId: (await createUserAndSession()).id,
      role: "MEMBER",
      parentId: chairMemberId,
    });
    await createMember({
      eventId,
      userId: (await createUserAndSession()).id,
      role: "DIVISION_LEADER",
      parentId: chairMemberId,
    });

    const res = await supertest(app)
      .get(`/api/v1/events/${eventId}/members?page=1&perPage=2&role=MEMBER`)
      .set("Origin", ORIGIN)
      .set("Cookie", cookieHeader(chair.tokenPlain, chair.csrfToken));

    if (res.status !== 200) {
      console.error(
        "T-O2 GAGAL endpoint=GET /members harapan=200 aktual=" +
          res.status +
          " body=" +
          JSON.stringify(res.body),
      );
    }
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.items.length).toBeLessThanOrEqual(2);
    expect(res.body.data.items.every((m: { role: string }) => m.role === "MEMBER")).toBe(true);
    expect(res.body.meta.page).toBe(1);
    expect(res.body.meta.perPage).toBe(2);
    expect(res.body.meta.total).toBeGreaterThan(0);
    expect(res.body.meta.totalPages).toBeGreaterThan(0);
  });

  it("T-O3 GET /members/:id → member, parent, children", async () => {
    const chair = await createUserAndSession();
    const { eventId, chairMemberId } = await createEventAndChair(chair.id);

    const div = await createUserAndSession();
    const divMember = await createMember({
      eventId,
      userId: div.id,
      role: "DIVISION_LEADER",
      parentId: chairMemberId,
    });

    const mem = await createUserAndSession();
    const memMember = await createMember({
      eventId,
      userId: mem.id,
      role: "MEMBER",
      parentId: divMember.id,
    });

    const res = await supertest(app)
      .get(`/api/v1/events/${eventId}/members/${divMember.id}`)
      .set("Origin", ORIGIN)
      .set("Cookie", cookieHeader(chair.tokenPlain, chair.csrfToken));

    if (res.status !== 200) {
      console.error(
        "T-O3 GAGAL endpoint=GET /members/:id harapan=200 aktual=" +
          res.status +
          " body=" +
          JSON.stringify(res.body),
      );
    }
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.member.id).toBe(divMember.id);
    expect(res.body.data.parent).toBeDefined();
    expect(res.body.data.parent!.id).toBe(chairMemberId);
    expect(Array.isArray(res.body.data.children)).toBe(true);
    expect(res.body.data.children.length).toBe(1);
    expect(res.body.data.children[0].id).toBe(memMember.id);
  });
});

describe("Leader authorization within subtree", () => {
  it("T-O4 leader PATCH status dalam subtree 200; di luar subtree 403", async () => {
    const chair = await createUserAndSession();
    const { eventId, chairMemberId } = await createEventAndChair(chair.id);

    const leader = await createUserAndSession();
    const leaderMember = await createMember({
      eventId,
      userId: leader.id,
      role: "DIVISION_LEADER",
      parentId: chairMemberId,
    });

    const inSubtree = await createUserAndSession();
    const inSubtreeMember = await createMember({
      eventId,
      userId: inSubtree.id,
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

    // Leader mengubah status anggota dalam subtree-nya → 200
    const inRes = await supertest(app)
      .patch(`/api/v1/events/${eventId}/members/${inSubtreeMember.id}/status`)
      .set("Origin", ORIGIN)
      .set("Cookie", cookieHeader(leader.tokenPlain, leader.csrfToken))
      .set("X-CSRF-Token", leader.csrfToken)
      .send({ status: "INACTIVE" });
    if (inRes.status !== 200) {
      console.error(
        "T-O4 GAGAL endpoint=PATCH /members/:id/status (in subtree) harapan=200 aktual=" +
          inRes.status +
          " body=" +
          JSON.stringify(inRes.body),
      );
    }
    expect(inRes.status).toBe(200);
    expect(inRes.body.success).toBe(true);

    // Leader mengubah status anggota di luar subtree → 403
    const outRes = await supertest(app)
      .patch(`/api/v1/events/${eventId}/members/${outsideMember.id}/status`)
      .set("Origin", ORIGIN)
      .set("Cookie", cookieHeader(leader.tokenPlain, leader.csrfToken))
      .set("X-CSRF-Token", leader.csrfToken)
      .send({ status: "INACTIVE" });
    if (outRes.status !== 403) {
      console.error(
        "T-O4 GAGAL endpoint=PATCH /members/:id/status (out subtree) harapan=403 aktual=" +
          outRes.status +
          " body=" +
          JSON.stringify(outRes.body),
      );
    }
    expect(outRes.status).toBe(403);
    expect(outRes.body.error.code).toBe("FORBIDDEN");
  });

  it("T-O5 leader PATCH role → 403 (hanya chair); leader move dalam subtree 200; move ke luar 403", async () => {
    const chair = await createUserAndSession();
    const { eventId, chairMemberId } = await createEventAndChair(chair.id);

    const leader = await createUserAndSession();
    const leaderMember = await createMember({
      eventId,
      userId: leader.id,
      role: "DIVISION_LEADER",
      parentId: chairMemberId,
    });

    const member = await createUserAndSession();
    const memberNode = await createMember({
      eventId,
      userId: member.id,
      role: "MEMBER",
      parentId: leaderMember.id,
    });

    const other = await createUserAndSession();
    const otherNode = await createMember({
      eventId,
      userId: other.id,
      role: "MEMBER",
      parentId: chairMemberId,
    });

    // Leader PATCH role → 403 (hanya chair)
    const roleRes = await supertest(app)
      .patch(`/api/v1/events/${eventId}/members/${memberNode.id}/role`)
      .set("Origin", ORIGIN)
      .set("Cookie", cookieHeader(leader.tokenPlain, leader.csrfToken))
      .set("X-CSRF-Token", leader.csrfToken)
      .send({ role: "MEMBER" });
    if (roleRes.status !== 403) {
      console.error(
        "T-O5 GAGAL endpoint=PATCH /members/:id/role (leader) harapan=403 aktual=" +
          roleRes.status +
          " body=" +
          JSON.stringify(roleRes.body),
      );
    }
    expect(roleRes.status).toBe(403);
    expect(roleRes.body.error.code).toBe("FORBIDDEN");

    // Leader move anggota dalam subtree ke parent dalam subtree → 200
    const moveIn = await supertest(app)
      .post(`/api/v1/events/${eventId}/members/${memberNode.id}/move`)
      .set("Origin", ORIGIN)
      .set("Cookie", cookieHeader(leader.tokenPlain, leader.csrfToken))
      .set("X-CSRF-Token", leader.csrfToken)
      .send({ newParentId: leaderMember.id });
    if (moveIn.status !== 200) {
      console.error(
        "T-O5 GAGAL endpoint=POST /members/:id/move (in subtree) harapan=200 aktual=" +
          moveIn.status +
          " body=" +
          JSON.stringify(moveIn.body),
      );
    }
    expect(moveIn.status).toBe(200);
    expect(moveIn.body.success).toBe(true);

    // Leader move anggota ke parent di luar subtree → 403
    const moveOut = await supertest(app)
      .post(`/api/v1/events/${eventId}/members/${memberNode.id}/move`)
      .set("Origin", ORIGIN)
      .set("Cookie", cookieHeader(leader.tokenPlain, leader.csrfToken))
      .set("X-CSRF-Token", leader.csrfToken)
      .send({ newParentId: otherNode.id });
    if (moveOut.status !== 403) {
      console.error(
        "T-O5 GAGAL endpoint=POST /members/:id/move (out subtree) harapan=403 aktual=" +
          moveOut.status +
          " body=" +
          JSON.stringify(moveOut.body),
      );
    }
    expect(moveOut.status).toBe(403);
    expect(moveOut.body.error.code).toBe("FORBIDDEN");
  });
});

describe("Member restrictions", () => {
  it("T-O6 member PATCH status/role/move → 403", async () => {
    const chair = await createUserAndSession();
    const { eventId, chairMemberId } = await createEventAndChair(chair.id);

    const member = await createUserAndSession();
    const memberNode = await createMember({
      eventId,
      userId: member.id,
      role: "MEMBER",
      parentId: chairMemberId,
    });

    const statusRes = await supertest(app)
      .patch(`/api/v1/events/${eventId}/members/${memberNode.id}/status`)
      .set("Origin", ORIGIN)
      .set("Cookie", cookieHeader(member.tokenPlain, member.csrfToken))
      .set("X-CSRF-Token", member.csrfToken)
      .send({ status: "INACTIVE" });
    if (statusRes.status !== 403) {
      console.error(
        "T-O6 GAGAL endpoint=PATCH /members/:id/status (member) harapan=403 aktual=" +
          statusRes.status +
          " body=" +
          JSON.stringify(statusRes.body),
      );
    }
    expect(statusRes.status).toBe(403);
    expect(statusRes.body.error.code).toBe("FORBIDDEN");

    const roleRes = await supertest(app)
      .patch(`/api/v1/events/${eventId}/members/${memberNode.id}/role`)
      .set("Origin", ORIGIN)
      .set("Cookie", cookieHeader(member.tokenPlain, member.csrfToken))
      .set("X-CSRF-Token", member.csrfToken)
      .send({ role: "MEMBER" });
    if (roleRes.status !== 403) {
      console.error(
        "T-O6 GAGAL endpoint=PATCH /members/:id/role (member) harapan=403 aktual=" +
          roleRes.status +
          " body=" +
          JSON.stringify(roleRes.body),
      );
    }
    expect(roleRes.status).toBe(403);
    expect(roleRes.body.error.code).toBe("FORBIDDEN");

    const moveRes = await supertest(app)
      .post(`/api/v1/events/${eventId}/members/${memberNode.id}/move`)
      .set("Origin", ORIGIN)
      .set("Cookie", cookieHeader(member.tokenPlain, member.csrfToken))
      .set("X-CSRF-Token", member.csrfToken)
      .send({ newParentId: chairMemberId });
    if (moveRes.status !== 403) {
      console.error(
        "T-O6 GAGAL endpoint=POST /members/:id/move (member) harapan=403 aktual=" +
          moveRes.status +
          " body=" +
          JSON.stringify(moveRes.body),
      );
    }
    expect(moveRes.status).toBe(403);
    expect(moveRes.body.error.code).toBe("FORBIDDEN");
  });

  it("T-O7 ubah status sendiri 422; nonaktifkan root 422; ubah role sendiri 422; role EVENT_CHAIR 422", async () => {
    const chair = await createUserAndSession();
    const { eventId, chairMemberId } = await createEventAndChair(chair.id);

    const member = await createUserAndSession();
    const memberNode = await createMember({
      eventId,
      userId: member.id,
      role: "MEMBER",
      parentId: chairMemberId,
    });

    // Route /status hanya untuk Chair/Leader, jadi uji "ubah status sendiri"
    // memakai aktor DIVISION_LEADER agar mencapai service (bukan 403 route).
    const leader = await createUserAndSession();
    const leaderNode = await createMember({
      eventId,
      userId: leader.id,
      role: "DIVISION_LEADER",
      parentId: chairMemberId,
    });

    // Ubah status sendiri -> 422
    const selfStatus = await supertest(app)
      .patch(`/api/v1/events/${eventId}/members/${leaderNode.id}/status`)
      .set("Origin", ORIGIN)
      .set("Cookie", cookieHeader(leader.tokenPlain, leader.csrfToken))
      .set("X-CSRF-Token", leader.csrfToken)
      .send({ status: "INACTIVE" });
    if (selfStatus.status !== 422) {
      console.error(
        "T-O7 GAGAL endpoint=PATCH /members/:id/status (self) harapan=422 aktual=" +
          selfStatus.status +
          " body=" +
          JSON.stringify(selfStatus.body),
      );
    }
    expect(selfStatus.status).toBe(422);
    expect(selfStatus.body.error.code).toBe("UNPROCESSABLE");

    // Nonaktifkan root (chair) -> 422
    const rootInactive = await supertest(app)
      .patch(`/api/v1/events/${eventId}/members/${chairMemberId}/status`)
      .set("Origin", ORIGIN)
      .set("Cookie", cookieHeader(chair.tokenPlain, chair.csrfToken))
      .set("X-CSRF-Token", chair.csrfToken)
      .send({ status: "INACTIVE" });
    if (rootInactive.status !== 422) {
      console.error(
        "T-O7 GAGAL endpoint=PATCH /members/:id/status (root) harapan=422 aktual=" +
          rootInactive.status +
          " body=" +
          JSON.stringify(rootInactive.body),
      );
    }
    expect(rootInactive.status).toBe(422);
    expect(rootInactive.body.error.code).toBe("UNPROCESSABLE");

    // Ubah role sendiri -> 422 (Chair mengubah role dirinya sendiri)
    const selfRole = await supertest(app)
      .patch(`/api/v1/events/${eventId}/members/${chairMemberId}/role`)
      .set("Origin", ORIGIN)
      .set("Cookie", cookieHeader(chair.tokenPlain, chair.csrfToken))
      .set("X-CSRF-Token", chair.csrfToken)
      .send({ role: "MEMBER" });
    if (selfRole.status !== 422) {
      console.error(
        "T-O7 GAGAL endpoint=PATCH /members/:id/role (self) harapan=422 aktual=" +
          selfRole.status +
          " body=" +
          JSON.stringify(selfRole.body),
      );
    }
    expect(selfRole.status).toBe(422);
    expect(selfRole.body.error.code).toBe("UNPROCESSABLE");

    // Ubah role menjadi EVENT_CHAIR -> 422 (validator hanya DIVISION_LEADER|MEMBER)
    const chairRole = await supertest(app)
      .patch(`/api/v1/events/${eventId}/members/${memberNode.id}/role`)
      .set("Origin", ORIGIN)
      .set("Cookie", cookieHeader(chair.tokenPlain, chair.csrfToken))
      .set("X-CSRF-Token", chair.csrfToken)
      .send({ role: "EVENT_CHAIR" });
    if (chairRole.status !== 422) {
      console.error(
        "T-O7 GAGAL endpoint=PATCH /members/:id/role (EVENT_CHAIR) harapan=422 aktual=" +
          chairRole.status +
          " body=" +
          JSON.stringify(chairRole.body),
      );
    }
    expect(chairRole.status).toBe(422);
    expect(chairRole.body.error.code).toBe("UNPROCESSABLE");
  });

  it("T-O8 move cycle/self-parent/root → 422", async () => {
    const chair = await createUserAndSession();
    const { eventId, chairMemberId } = await createEventAndChair(chair.id);

    const a = await createUserAndSession();
    const aNode = await createMember({
      eventId,
      userId: a.id,
      role: "MEMBER",
      parentId: chairMemberId,
    });

    const b = await createUserAndSession();
    const bNode = await createMember({
      eventId,
      userId: b.id,
      role: "MEMBER",
      parentId: aNode.id,
    });

    // Move A di bawah B (keturunan A) → cycle → 422
    const cycle = await supertest(app)
      .post(`/api/v1/events/${eventId}/members/${aNode.id}/move`)
      .set("Origin", ORIGIN)
      .set("Cookie", cookieHeader(chair.tokenPlain, chair.csrfToken))
      .set("X-CSRF-Token", chair.csrfToken)
      .send({ newParentId: bNode.id });
    if (cycle.status !== 422) {
      console.error(
        "T-O8 GAGAL endpoint=POST /members/:id/move (cycle) harapan=422 aktual=" +
          cycle.status +
          " body=" +
          JSON.stringify(cycle.body),
      );
    }
    expect(cycle.status).toBe(422);
    expect(cycle.body.error.code).toBe("UNPROCESSABLE");

    // Move node ke dirinya sendiri → 422
    const self = await supertest(app)
      .post(`/api/v1/events/${eventId}/members/${aNode.id}/move`)
      .set("Origin", ORIGIN)
      .set("Cookie", cookieHeader(chair.tokenPlain, chair.csrfToken))
      .set("X-CSRF-Token", chair.csrfToken)
      .send({ newParentId: aNode.id });
    if (self.status !== 422) {
      console.error(
        "T-O8 GAGAL endpoint=POST /members/:id/move (self) harapan=422 aktual=" +
          self.status +
          " body=" +
          JSON.stringify(self.body),
      );
    }
    expect(self.status).toBe(422);
    expect(self.body.error.code).toBe("UNPROCESSABLE");

    // Move root (chair) → 422
    const rootMove = await supertest(app)
      .post(`/api/v1/events/${eventId}/members/${chairMemberId}/move`)
      .set("Origin", ORIGIN)
      .set("Cookie", cookieHeader(chair.tokenPlain, chair.csrfToken))
      .set("X-CSRF-Token", chair.csrfToken)
      .send({ newParentId: aNode.id });
    if (rootMove.status !== 422) {
      console.error(
        "T-O8 GAGAL endpoint=POST /members/:id/move (root) harapan=422 aktual=" +
          rootMove.status +
          " body=" +
          JSON.stringify(rootMove.body),
      );
    }
    expect(rootMove.status).toBe(422);
    expect(rootMove.body.error.code).toBe("UNPROCESSABLE");
  });

  it("T-O9 move cross-event parent → 404/422; move no-op → 200 {noop:true}", async () => {
    const chair = await createUserAndSession();
    const { eventId, chairMemberId } = await createEventAndChair(chair.id);

    const member = await createUserAndSession();
    const memberNode = await createMember({
      eventId,
      userId: member.id,
      role: "MEMBER",
      parentId: chairMemberId,
    });

    // Event lain
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

    const cross = await supertest(app)
      .post(`/api/v1/events/${eventId}/members/${memberNode.id}/move`)
      .set("Origin", ORIGIN)
      .set("Cookie", cookieHeader(chair.tokenPlain, chair.csrfToken))
      .set("X-CSRF-Token", chair.csrfToken)
      .send({ newParentId: otherMember.id });
    if (cross.status !== 404 && cross.status !== 422) {
      console.error(
        "T-O9 GAGAL endpoint=POST /members/:id/move (cross-event) harapan=404/422 aktual=" +
          cross.status +
          " body=" +
          JSON.stringify(cross.body),
      );
    }
    expect([404, 422]).toContain(cross.status);

    // No-op: parent sama → 200 {noop:true}
    const noop = await supertest(app)
      .post(`/api/v1/events/${eventId}/members/${memberNode.id}/move`)
      .set("Origin", ORIGIN)
      .set("Cookie", cookieHeader(chair.tokenPlain, chair.csrfToken))
      .set("X-CSRF-Token", chair.csrfToken)
      .send({ newParentId: chairMemberId });
    if (noop.status !== 200) {
      console.error(
        "T-O9 GAGAL endpoint=POST /members/:id/move (noop) harapan=200 aktual=" +
          noop.status +
          " body=" +
          JSON.stringify(noop.body),
      );
    }
    expect(noop.status).toBe(200);
    expect(noop.body.success).toBe(true);
    expect(noop.body.data.noop).toBe(true);
  });

  it("T-O10 membership INACTIVE GET /organization → 403", async () => {
    const chair = await createUserAndSession();
    const { eventId, chairMemberId } = await createEventAndChair(chair.id);

    const inactive = await createUserAndSession();
    await createMember({
      eventId,
      userId: inactive.id,
      role: "MEMBER",
      parentId: chairMemberId,
      status: "INACTIVE",
    });

    const res = await supertest(app)
      .get(`/api/v1/events/${eventId}/organization`)
      .set("Origin", ORIGIN)
      .set("Cookie", cookieHeader(inactive.tokenPlain, inactive.csrfToken));
    if (res.status !== 403) {
      console.error(
        "T-O10 GAGAL endpoint=GET /organization (inactive) harapan=403 aktual=" +
          res.status +
          " body=" +
          JSON.stringify(res.body),
      );
    }
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
  });
});

describe("Email tidak diekspos via organization (Phase 7 hardening)", () => {
  function assertNoEmailInNodes(nodes: unknown[]): void {
    for (const node of nodes) {
      expect(node).not.toHaveProperty("email");
      expect(node).toHaveProperty("name");
      expect(node).toHaveProperty("role");
      expect(node).toHaveProperty("status");
    }
  }

  it("T-E1 GET /organization sebagai MEMBER → node tanpa email", async () => {
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
      .get(`/api/v1/events/${eventId}/organization`)
      .set("Origin", ORIGIN)
      .set("Cookie", cookieHeader(member.tokenPlain, member.csrfToken));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    assertNoEmailInNodes(res.body.data.nodes);
    for (const edge of res.body.data.edges) {
      expect(edge).not.toHaveProperty("email");
    }
  });

  it("T-E2 GET /members sebagai MEMBER → items tanpa email", async () => {
    const chair = await createUserAndSession();
    const { eventId } = await createEventAndChair(chair.id);

    const member = await createUserAndSession();
    await createMember({
      eventId,
      userId: member.id,
      role: "MEMBER",
      parentId: (
        await prisma.eventMember.findFirst({ where: { eventId, role: "EVENT_CHAIR" } })
      )!.id,
    });

    const res = await supertest(app)
      .get(`/api/v1/events/${eventId}/members?page=1&perPage=10`)
      .set("Origin", ORIGIN)
      .set("Cookie", cookieHeader(member.tokenPlain, member.csrfToken));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data.items)).toBe(true);
    for (const item of res.body.data.items) {
      expect(item).not.toHaveProperty("email");
    }
    // meta tetap intact
    expect(res.body.meta).toMatchObject({ page: 1, perPage: 10, total: expect.any(Number), totalPages: expect.any(Number) });
  });

  it("T-E3 GET /members/:id sebagai MEMBER → member tanpa email", async () => {
    const chair = await createUserAndSession();
    const { eventId, chairMemberId } = await createEventAndChair(chair.id);

    const member = await createUserAndSession();
    const memberNode = await createMember({
      eventId,
      userId: member.id,
      role: "MEMBER",
      parentId: chairMemberId,
    });

    const res = await supertest(app)
      .get(`/api/v1/events/${eventId}/members/${memberNode.id}`)
      .set("Origin", ORIGIN)
      .set("Cookie", cookieHeader(member.tokenPlain, member.csrfToken));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.member).not.toHaveProperty("email");
    expect(res.body.data.member.name).toBeDefined();
    expect(res.body.data.parent).not.toHaveProperty("email");
    for (const child of res.body.data.children) {
      expect(child).not.toHaveProperty("email");
    }
  });

  it("T-E4 PATCH /members/:id/status oleh Chair → member tanpa email", async () => {
    const chair = await createUserAndSession();
    const { eventId, chairMemberId } = await createEventAndChair(chair.id);

    const member = await createUserAndSession();
    const memberNode = await createMember({
      eventId,
      userId: member.id,
      role: "MEMBER",
      parentId: chairMemberId,
    });

    const res = await supertest(app)
      .patch(`/api/v1/events/${eventId}/members/${memberNode.id}/status`)
      .set("Origin", ORIGIN)
      .set("Cookie", cookieHeader(chair.tokenPlain, chair.csrfToken))
      .set("X-CSRF-Token", chair.csrfToken)
      .send({ status: "INACTIVE" });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.member).not.toHaveProperty("email");
    expect(res.body.data.member.status).toBe("INACTIVE");
  });
});
