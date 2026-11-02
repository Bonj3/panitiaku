import { hash } from "@node-rs/argon2";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../src/config/database.js";
import { createApp } from "../src/app.ts";
import { hashToken } from "../src/shared/utils/token.js";
import supertest from "supertest";

// ---------------------------------------------------------------------------
// Konfigurasi isolasi DB & rate-limit
// ---------------------------------------------------------------------------
//
// Semua user/sesi dalam berkas ini dibuat langsung via Prisma (bukan
// /register|/login|/refresh), sehingga kuota credentialRateLimiter (10/menit
// per proses, singleton) TIDAK terpakai sama sekali. Rate-limit aman.
//
// DB: test/setup.ts → postgresql://localhost:5433/event_committee_test.
// afterAll membersihkan event (cascade ke event_members) + user uji.

const app = createApp();
const testUserIds: string[] = [];
const testEventIds: string[] = [];

function email(label: string): string {
  return `evt.${label}.${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
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

async function createUserAndSession(
  _role: "EVENT_CHAIR" | "MEMBER" = "EVENT_CHAIR",
): Promise<{ id: string; email: string; tokenPlain: string; csrfToken: string }> {
  const e = email("user");
  const passwordHash = await hash("password123");
  const user = await prisma.user.create({ data: { name: "Test User", email: e, passwordHash } });
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

async function createEventViaApi(
  tokenPlain: string,
  csrfToken: string,
  input?: { name?: string; slug?: string; description?: string },
): Promise<{ eventId: string; slug: string }> {
  const res = await supertest(app)
    .post("/api/v1/events")
    .set("Origin", ORIGIN)
    .set("Cookie", `ec_csrf=${csrfToken}; ec_session=${tokenPlain}`)
    .set("X-CSRF-Token", csrfToken)
    .send({ name: input?.name ?? "Event Test", slug: input?.slug, description: input?.description });
  expect(res.status).toBe(201);
  expect(res.body.success).toBe(true);
  const eventId = res.body.data.event.id;
  testEventIds.push(eventId);
  return { eventId, slug: res.body.data.event.slug };
}

beforeAll(async () => {
  await prisma.$connect();
});

afterEach(async () => {
  // Revoke session user uji.
  if (testUserIds.length) {
    await prisma.session.deleteMany({ where: { userId: { in: testUserIds } } });
  }
});

afterAll(async () => {
  // Hapus audit_logs untuk event uji SEBELUM event (actor_id RESTRICT pada
  // event_members yang dicascade oleh event.deleteMany), lalu user.
  if (testUserIds.length) {
    await prisma.auditLog.deleteMany({
      where: { eventId: { in: testEventIds } },
    });
    await prisma.event.deleteMany({ where: { createdById: { in: testUserIds } } });
    await prisma.session.deleteMany({ where: { userId: { in: testUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: testUserIds } } });
  }
  await prisma.$disconnect();
});

describe("POST /api/v1/events", () => {
  it("T-E1 create event 201: createdById=user, membership root benar; GET detail 200", async () => {
    const { id: userId, tokenPlain, csrfToken } = await createUserAndSession("EVENT_CHAIR");
    const slug = `evt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const res = await supertest(app)
      .post("/api/v1/events")
      .set("Origin", ORIGIN)
      .set("Cookie", `ec_csrf=${csrfToken}; ec_session=${tokenPlain}`)
      .set("X-CSRF-Token", csrfToken)
      .send({ name: "Event Pertama", slug, description: "desc" });

    if (res.status !== 201) {
      console.error(
        "T-E1 GAGAL endpoint=POST /api/v1/events harapan=201 aktual=" +
          res.status +
          " body=" +
          JSON.stringify(res.body),
      );
    }
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.event.id).toBeDefined();
    expect(res.body.data.event.name).toBe("Event Pertama");
    expect(res.body.data.event.slug).toBe(slug);
    expect(res.body.data.event.status).toBe("OPEN");
    expect(res.body.data.membership.role).toBe("EVENT_CHAIR");
    expect(res.body.data.membership.status).toBe("ACTIVE");
    expect(res.body.data.membership.userId).toBe(userId);

    // parentId tidak ada di response body (MEMBERSHIP_SELECT); verifikasi root via DB
    const dbMember = await prisma.eventMember.findFirst({
      where: { eventId: res.body.data.event.id, userId },
    });
    expect(dbMember!.parentId).toBeNull();
    expect(dbMember!.role).toBe("EVENT_CHAIR");

    // createdById tidak ada di response body (EVENT_SELECT); verifikasi via DB
    const dbEvent = await prisma.event.findUnique({ where: { id: res.body.data.event.id } });
    expect(dbEvent!.createdById).toBe(userId);

    const detail = await supertest(app)
      .get(`/api/v1/events/${res.body.data.event.id}`)
      .set("Origin", ORIGIN)
      .set("Cookie", `ec_csrf=${csrfToken}; ec_session=${tokenPlain}`);
    expect(detail.status).toBe(200);
    expect(detail.body.success).toBe(true);
    expect(detail.body.data.event.id).toBe(res.body.data.event.id);
    expect(detail.body.data.membership.role).toBe("EVENT_CHAIR");
  });

  it("T-E2 slug duplikat → 409; slug invalid → 422", async () => {
    const { tokenPlain, csrfToken } = await createUserAndSession("EVENT_CHAIR");
    const slug = `dup-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    await createEventViaApi(tokenPlain, csrfToken, { name: "Duplikat A", slug });

    const duplikat = await supertest(app)
      .post("/api/v1/events")
      .set("Origin", ORIGIN)
      .set("Cookie", `ec_csrf=${csrfToken}; ec_session=${tokenPlain}`)
      .set("X-CSRF-Token", csrfToken)
      .send({ name: "Duplikat B", slug });
    if (duplikat.status !== 409) {
      console.error(
        "T-E2 GAGAL endpoint=POST /api/v1/events (slug duplikat) harapan=409 aktual=" +
          duplikat.status +
          " body=" +
          JSON.stringify(duplikat.body),
      );
    }
    expect(duplikat.status).toBe(409);
    expect(duplikat.body.success).toBe(false);
    expect(duplikat.body.error.code).toBe("CONFLICT");

    const invalid = await supertest(app)
      .post("/api/v1/events")
      .set("Origin", ORIGIN)
      .set("Cookie", `ec_csrf=${csrfToken}; ec_session=${tokenPlain}`)
      .set("X-CSRF-Token", csrfToken)
      .send({ name: "Slug Salah", slug: "Invalid_Slug!" });
    if (invalid.status !== 422) {
      console.error(
        "T-E2 GAGAL endpoint=POST /api/v1/events (slug invalid) harapan=422 aktual=" +
          invalid.status +
          " body=" +
          JSON.stringify(invalid.body),
      );
    }
    expect(invalid.status).toBe(422);
    expect(invalid.body.success).toBe(false);
    expect(invalid.body.error.code).toBe("UNPROCESSABLE");
  });
});

describe("GET /api/v1/events/:eventId", () => {
  it("T-E3 user tanpa membership → 403; tanpa sesi → 401", async () => {
    const chair = await createUserAndSession("EVENT_CHAIR");
    const { eventId } = await createEventViaApi(chair.tokenPlain, chair.csrfToken, {
      name: "Event Akses",
      slug: "event-akses",
    });

    // User lain (bukan anggota) → 403 BR-01
    const outsider = await createUserAndSession("MEMBER");
    const resOutsider = await supertest(app)
      .get(`/api/v1/events/${eventId}`)
      .set("Origin", ORIGIN)
      .set("Cookie", `ec_csrf=${outsider.csrfToken}; ec_session=${outsider.tokenPlain}`);
    if (resOutsider.status !== 403) {
      console.error(
        "T-E3 GAGAL endpoint=GET /api/v1/events/:id (bukan anggota) harapan=403 aktual=" +
          resOutsider.status +
          " body=" +
          JSON.stringify(resOutsider.body),
      );
    }
    expect(resOutsider.status).toBe(403);
    expect(resOutsider.body.error.code).toBe("FORBIDDEN");

    // Tanpa sesi → 401
    const resNoSession = await supertest(app)
      .get(`/api/v1/events/${eventId}`)
      .set("Origin", ORIGIN);
    if (resNoSession.status !== 401) {
      console.error(
        "T-E3 GAGAL endpoint=GET /api/v1/events/:id (tanpa sesi) harapan=401 aktual=" +
          resNoSession.status +
          " body=" +
          JSON.stringify(resNoSession.body),
      );
    }
    expect(resNoSession.status).toBe(401);
    expect(resNoSession.body.error.code).toBe("UNAUTHORIZED");
  });
});

describe("PATCH /api/v1/events/:eventId", () => {
  it("T-E4 member (MEMBER, ACTIVE) PATCH → 403; close → 403", async () => {
    const chair = await createUserAndSession("EVENT_CHAIR");
    const { eventId } = await createEventViaApi(chair.tokenPlain, chair.csrfToken, {
      name: "Event Member",
      slug: "event-member",
    });

    // Tambah member ACTIVE
    const member = await createUserAndSession("MEMBER");
    await prisma.eventMember.create({
      data: {
        eventId,
        userId: member.id,
        role: "MEMBER",
        parentId: (await prisma.eventMember.findFirst({ where: { eventId, role: "EVENT_CHAIR" } })).id,
        status: "ACTIVE",
      },
    });

    const patch = await supertest(app)
      .patch(`/api/v1/events/${eventId}`)
      .set("Origin", ORIGIN)
      .set("Cookie", `ec_csrf=${member.csrfToken}; ec_session=${member.tokenPlain}`)
      .set("X-CSRF-Token", member.csrfToken)
      .send({ name: "Diubah Member" });
    if (patch.status !== 403) {
      console.error(
        "T-E4 GAGAL endpoint=PATCH /api/v1/events/:id (member) harapan=403 aktual=" +
          patch.status +
          " body=" +
          JSON.stringify(patch.body),
      );
    }
    expect(patch.status).toBe(403);
    expect(patch.body.error.code).toBe("FORBIDDEN");

    const close = await supertest(app)
      .post(`/api/v1/events/${eventId}/close`)
      .set("Origin", ORIGIN)
      .set("Cookie", `ec_csrf=${member.csrfToken}; ec_session=${member.tokenPlain}`)
      .set("X-CSRF-Token", member.csrfToken)
      .send({ confirm: true });
    expect(close.status).toBe(403);
    expect(close.body.error.code).toBe("FORBIDDEN");
  });

  it("T-E5 chair PATCH name → 200 berubah; role/createdById di body diabaikan", async () => {
    const { id: userId, tokenPlain, csrfToken } = await createUserAndSession("EVENT_CHAIR");
    const { eventId } = await createEventViaApi(tokenPlain, csrfToken, {
      name: "Nama Lama",
      slug: "patch-event",
    });

    const res = await supertest(app)
      .patch(`/api/v1/events/${eventId}`)
      .set("Origin", ORIGIN)
      .set("Cookie", `ec_csrf=${csrfToken}; ec_session=${tokenPlain}`)
      .set("X-CSRF-Token", csrfToken)
      .send({ name: "Nama Baru", role: "MEMBER", createdById: "00000000-0000-0000-0000-000000000000" });
    if (res.status !== 200) {
      console.error(
        "T-E5 GAGAL endpoint=PATCH /api/v1/events/:id harapan=200 aktual=" +
          res.status +
          " body=" +
          JSON.stringify(res.body),
      );
    }
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.event.name).toBe("Nama Baru");

    // role/owner tidak berubah di DB
    const after = await prisma.event.findUnique({ where: { id: eventId } });
    expect(after!.createdById).toBe(userId);
    const m = await prisma.eventMember.findUnique({ where: { id: (await prisma.eventMember.findFirst({ where: { eventId, userId } }))!.id } });
    expect(m!.role).toBe("EVENT_CHAIR");
  });
});

describe("POST /api/v1/events/:eventId/close", () => {
  it("T-E6 close → 200 cancelledCount 0; close kedua 409; GET tetap 200 status CLOSED", async () => {
    const { tokenPlain, csrfToken } = await createUserAndSession("EVENT_CHAIR");
    const { eventId } = await createEventViaApi(tokenPlain, csrfToken, { name: "Event Tutup", slug: "tutup-event" });

    const close1 = await supertest(app)
      .post(`/api/v1/events/${eventId}/close`)
      .set("Origin", ORIGIN)
      .set("Cookie", `ec_csrf=${csrfToken}; ec_session=${tokenPlain}`)
      .set("X-CSRF-Token", csrfToken)
      .send({ confirm: true });
    if (close1.status !== 200) {
      console.error(
        "T-E6 GAGAL endpoint=POST /api/v1/events/:id/close (pertama) harapan=200 aktual=" +
          close1.status +
          " body=" +
          JSON.stringify(close1.body),
      );
    }
    expect(close1.status).toBe(200);
    expect(close1.body.success).toBe(true);
    expect(close1.body.data.cancelledCount).toBe(0);

    const close2 = await supertest(app)
      .post(`/api/v1/events/${eventId}/close`)
      .set("Origin", ORIGIN)
      .set("Cookie", `ec_csrf=${csrfToken}; ec_session=${tokenPlain}`)
      .set("X-CSRF-Token", csrfToken)
      .send({ confirm: true });
    if (close2.status !== 409) {
      console.error(
        "T-E6 GAGAL endpoint=POST /api/v1/events/:id/close (kedua) harapan=409 aktual=" +
          close2.status +
          " body=" +
          JSON.stringify(close2.body),
      );
    }
    expect(close2.status).toBe(409);
    expect(close2.body.error.code).toBe("CONFLICT");

    const detail = await supertest(app)
      .get(`/api/v1/events/${eventId}`)
      .set("Origin", ORIGIN)
      .set("Cookie", `ec_csrf=${csrfToken}; ec_session=${tokenPlain}`);
    expect(detail.status).toBe(200);
    expect(detail.body.data.event.status).toBe("CLOSED");
  });
});

describe("keanggunaan & lintas-event", () => {
  it("T-E7 membership INACTIVE → 403 walau event ada", async () => {
    const chair = await createUserAndSession("EVENT_CHAIR");
    const { eventId } = await createEventViaApi(chair.tokenPlain, chair.csrfToken, {
      name: "Event Inactive",
      slug: "event-inactive",
    });

    const inactive = await createUserAndSession("MEMBER");
    await prisma.eventMember.create({
      data: {
        eventId,
        userId: inactive.id,
        role: "MEMBER",
        parentId: (await prisma.eventMember.findFirst({ where: { eventId, role: "EVENT_CHAIR" } })).id,
        status: "INACTIVE",
      },
    });

    const res = await supertest(app)
      .get(`/api/v1/events/${eventId}`)
      .set("Origin", ORIGIN)
      .set("Cookie", `ec_csrf=${inactive.csrfToken}; ec_session=${inactive.tokenPlain}`);
    if (res.status !== 403) {
      console.error(
        "T-E7 GAGAL endpoint=GET /api/v1/events/:id (inactive) harapan=403 aktual=" +
          res.status +
          " body=" +
          JSON.stringify(res.body),
      );
    }
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
  });

  it("T-E8 lintas-event: chair event A GET/PATCH event B → 403 (IDOR)", async () => {
    const chairA = await createUserAndSession("EVENT_CHAIR");
    await createEventViaApi(chairA.tokenPlain, chairA.csrfToken, {
      name: "Event A",
      slug: "event-a",
    });

    // Event B dibuat oleh user LAIN, sehingga chairA bukan anggota event B.
    const userB = await createUserAndSession("EVENT_CHAIR");
    const { eventId: eventB } = await createEventViaApi(userB.tokenPlain, userB.csrfToken, {
      name: "Event B",
      slug: "event-b",
    });

    const getB = await supertest(app)
      .get(`/api/v1/events/${eventB}`)
      .set("Origin", ORIGIN)
      .set("Cookie", `ec_csrf=${chairA.csrfToken}; ec_session=${chairA.tokenPlain}`);
    if (getB.status !== 403) {
      console.error(
        "T-E8 GAGAL endpoint=GET /api/v1/events/:id (lintas-event) harapan=403 aktual=" +
          getB.status +
          " body=" +
          JSON.stringify(getB.body),
      );
    }
    expect(getB.status).toBe(403);
    expect(getB.body.error.code).toBe("FORBIDDEN");

    const patchB = await supertest(app)
      .patch(`/api/v1/events/${eventB}`)
      .set("Origin", ORIGIN)
      .set("Cookie", `ec_csrf=${chairA.csrfToken}; ec_session=${chairA.tokenPlain}`)
      .set("X-CSRF-Token", chairA.csrfToken)
      .send({ name: "Diubah Lintas" });
    expect(patchB.status).toBe(403);
    expect(patchB.body.error.code).toBe("FORBIDDEN");
  });

  it("T-E9 eventId bukan UUID / tidak ada → 404", async () => {
    const { tokenPlain, csrfToken } = await createUserAndSession("EVENT_CHAIR");

    const notUuid = await supertest(app)
      .get("/api/v1/events/bukan-uuid")
      .set("Origin", ORIGIN)
      .set("Cookie", `ec_csrf=${csrfToken}; ec_session=${tokenPlain}`);
    if (notUuid.status !== 404) {
      console.error(
        "T-E9 GAGAL endpoint=GET /api/v1/events/:id (bukan UUID) harapan=404 aktual=" +
          notUuid.status +
          " body=" +
          JSON.stringify(notUuid.body),
      );
    }
    expect(notUuid.status).toBe(404);
    expect(notUuid.body.error.code).toBe("NOT_FOUND");

    const notExist = await supertest(app)
      .get("/api/v1/events/" + "00000000-0000-0000-0000-000000000000")
      .set("Origin", ORIGIN)
      .set("Cookie", `ec_csrf=${csrfToken}; ec_session=${tokenPlain}`);
    if (notExist.status !== 404) {
      console.error(
        "T-E9 GAGAL endpoint=GET /api/v1/events/:id (tidak ada) harapan=404 aktual=" +
          notExist.status +
          " body=" +
          JSON.stringify(notExist.body),
      );
    }
    expect(notExist.status).toBe(404);
    expect(notExist.body.error.code).toBe("NOT_FOUND");
  });

  it("T-E10 tepat satu root: buat root kedua via Prisma harus gagal (partial unique)", async () => {
    const { id: userId, tokenPlain, csrfToken } = await createUserAndSession("EVENT_CHAIR");
    const { eventId } = await createEventViaApi(tokenPlain, csrfToken, {
      name: "Root Ganda",
      slug: "root-ganda",
    });

    let threw = false;
    try {
      await prisma.eventMember.create({
        data: {
          eventId,
          userId,
          role: "EVENT_CHAIR",
          parentId: null,
          status: "ACTIVE",
        },
      });
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);

    // Pastikan tidak ada baris root kedua yang tersisa
    const roots = await prisma.eventMember.count({
      where: { eventId, role: "EVENT_CHAIR", parentId: null },
    });
    expect(roots).toBe(1);
  });
});

describe("GET /api/v1/auth/me", () => {
  it("T-E11 /auth/me memuat membership dengan event (nama/slug/status), tanpa passwordHash", async () => {
    const { tokenPlain, csrfToken } = await createUserAndSession("EVENT_CHAIR");
    await createEventViaApi(tokenPlain, csrfToken, { name: "Me Event", slug: "me-event" });

    const res = await supertest(app)
      .get("/api/v1/auth/me")
      .set("Origin", ORIGIN)
      .set("Cookie", `ec_csrf=${csrfToken}; ec_session=${tokenPlain}`);
    if (res.status !== 200) {
      console.error(
        "T-E11 GAGAL endpoint=GET /api/v1/auth/me harapan=200 aktual=" +
          res.status +
          " body=" +
          JSON.stringify(res.body),
      );
    }
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.user.passwordHash).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain("passwordHash");
    expect(Array.isArray(res.body.data.memberships)).toBe(true);
    const found = res.body.data.memberships.find(
      (m: { event: { slug: string } }) => m.event.slug === "me-event",
    );
    expect(found).toBeDefined();
    expect(found!.event.name).toBe("Me Event");
    expect(found!.event.status).toBe("OPEN");
    expect(found!.role).toBe("EVENT_CHAIR");
    expect(found!.status).toBe("ACTIVE");
  });
});
