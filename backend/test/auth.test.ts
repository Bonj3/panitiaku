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
// DB: test/setup.ts menargetkan postgresql://localhost:5433/event_committee_test
// (port Docker, bukan DB produksi 5433/event_committee). Tabel users/sessions
// sudah dibuat via migration SQL. afterAll menghapus HANYA user uji (prefix
// email unik per run) agar data user lain tidak tersentuh.
//
// Rate-limit: `credentialRateLimiter` (10 req/menit per IP) adalah singleton
// di level module auth.routes.ts, dibagikan semua createApp() — membuat instance
// baru aplikasi TIDAK mereset kuota. Kuota berlaku untuk seluruh berkas ini.
// Total permintaan ke endpoint kredensial (register/login/refresh) dalam berkas
// ini dibatasi tepat 9 (bawah batas 10):
//   T-A1: 1 register
//   T-A2: 1 register (user sudah dibuat via Prisma, hanya percobaan duplikat)
//   T-A3: 1 register (validasi gagal)
//   T-A4: 1 login (user sudah dibuat via Prisma)
//   T-A5: 2 login (salah kata sandi + email tidak dikenal)
//   T-A8: 1 refresh
//   T-A10: 2 refresh (konkurensi)
//   T-A7: 0 (session dibuat lewat Prisma, bukan /login)
//   T-A6, T-A9, T-A11: 0 (tidak ada kredensial)
// Total = 9. Tidak ada pemanggilan berulang ke endpoint yang sama.
//
// T-A7/T-A8/T-A10 membuat session langsung melalui Prisma (token hash diketahui)
// dan mengatur cookie secara manual lewat header Cookie, sehingga tidak menembak
// rate-limit /login.
//
// NODE_ENV=test ⇒ trust proxy OFF, sehingga X-Forwarded-For tidak memalsukan IP.
//
// Catatan validasi: error-handler.ts memetakan ZodError → 422 UNPROCESSABLE
// (bukan 400). Kode aplikasi TIDAK diubah, sehingga T-A3 menuntut 422.

const app = createApp();

const testEmails: string[] = []; // email yang terdaftar lewat endpoint (cleanup)
const testUserIds: string[] = []; // user yang dibuat lewat Prisma (cleanup)

function email(label: string): string {
  const e = `test.${label}.${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  testEmails.push(e);
  return e;
}

// Membuat user langsung via Prisma (bukan /register) agar tidak menambah kuota
// credentialRateLimiter. Password di-hash argon2 agar login bisa diverifikasi.
async function createUserViaPrisma(email: string, password: string) {
  const passwordHash = await hash(password);
  const user = await prisma.user.create({
    data: { name: "Pre-created", email, passwordHash },
  });
  testUserIds.push(user.id);
  return { id: user.id, email, password };
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

function extractSessionCookie(res: supertest.Response): string | undefined {
  const match = getSetCookieArray(res).find((c) => c.startsWith("ec_session="));
  return match ? match.split(";")[0].split("=")[1] : undefined;
}

// Origin wajib untuk endpoint auth publik (csrf middleware memvalidasi Origin
// terhadap CORS_ORIGIN allowlist). Sesuaikan dengan setup.ts: localhost:5173.
const ORIGIN = "http://localhost:5173";

// Membuat user + session aktif langsung di DB (lewati /login agar tidak
// menambah kuota rate-limit). Mengembalikan { userId, tokenPlain, csrfToken }.
async function createDbSessionAndCsrf(): Promise<{
  userId: string;
  tokenPlain: string;
  csrfToken: string;
}> {
  const e = email("db-session");
  const user = await prisma.user.create({
    data: { name: "Db Session", email: e, passwordHash: "x" },
  });
  testUserIds.push(user.id);

  const tokenPlain = `testtoken_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await prisma.session.create({
    data: {
      userId: user.id,
      tokenHash: hashToken(tokenPlain),
      expiresAt,
      ip: null,
      userAgent: null,
    },
  });

  // Ambil ec_csrf dari respons GET (csrf middleware pasang cookie pada semua respons).
  const getRes = await supertest(app)
    .get("/api/v1/health")
    .set("Origin", ORIGIN);
  const csrfToken = extractCsrfCookie(getRes);
  if (!csrfToken) {
    throw new Error("ec_csrf tidak tersedia dari respons");
  }
  return { userId: user.id, tokenPlain, csrfToken };
}

beforeAll(async () => {
  await prisma.$connect();
});

afterEach(async () => {
  // Revoke session semua user uji.
  if (testUserIds.length) {
    await prisma.session.deleteMany({
      where: { userId: { in: testUserIds } },
    });
  }
});

afterAll(async () => {
  // Hapus HANYA user uji — jangan sentuh data lain.
  if (testUserIds.length) {
    await prisma.session.deleteMany({ where: { userId: { in: testUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: testUserIds } } });
  }
  if (testEmails.length) {
    await prisma.user.deleteMany({ where: { email: { in: testEmails } } });
  }
  await prisma.$disconnect();
});

describe("POST /api/v1/auth/register", () => {
  it("T-A1 register sukses 201, body tidak mengandung passwordHash/password", async () => {
    const res = await supertest(app)
      .post("/api/v1/auth/register")
      .set("Origin", ORIGIN)
      .send({
        name: "Registrasi Sukses",
        email: email("reg-ok"),
        password: "password123",
      });

    if (res.status !== 201) {
      console.error(
        "T-A1 GAGAL endpoint=POST /api/v1/auth/register harapan=201 aktual=" +
          res.status +
          " body=" +
          JSON.stringify(res.body),
      );
    }
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.user).toMatchObject({
      id: expect.any(String),
      email: expect.stringContaining("@example.com"),
      name: "Registrasi Sukses",
    });
    expect(res.body.data.user.passwordHash).toBeUndefined();
    expect(res.body.data.user.password).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain("passwordHash");
    expect(JSON.stringify(res.body)).not.toContain("password");
  });

  it("T-A2 register email duplikat 409", async () => {
    const e = email("reg-dup");
    await createUserViaPrisma(e, "password123"); // user sudah ada via Prisma

    const res = await supertest(app)
      .post("/api/v1/auth/register")
      .set("Origin", ORIGIN)
      .send({ name: "Duplikat", email: e, password: "password123" });

    if (res.status !== 409) {
      console.error(
        "T-A2 GAGAL endpoint=POST /api/v1/auth/register harapan=409 aktual=" +
          res.status +
          " body=" +
          JSON.stringify(res.body),
      );
    }
    expect(res.status).toBe(409);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe("CONFLICT");
  });

  it("T-A3 register validasi gagal (password <8 / email invalid) 422 envelope error", async () => {
    const res = await supertest(app)
      .post("/api/v1/auth/register")
      .set("Origin", ORIGIN)
      .send({ name: "X", email: "bukan-email", password: "short" });

    if (res.status !== 422) {
      console.error(
        "T-A3 GAGAL endpoint=POST /api/v1/auth/register harapan=422 aktual=" +
          res.status +
          " body=" +
          JSON.stringify(res.body),
      );
    }
    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe("UNPROCESSABLE");
    expect(res.body.error.message).toBe("Validasi gagal");
    expect(Array.isArray(res.body.error.details?.fields)).toBe(true);
    expect(res.body.error.details.fields.length).toBeGreaterThan(0);
  });
});

describe("POST /api/v1/auth/login", () => {
  let loginUserEmail = ""; // diisi oleh T-A4, digunakan T-A5

  it("T-A4 login sukses 200 + Set-Cookie ec_session & ec_csrf; lalu GET /auth/me 200", async () => {
    const e = email("login-ok");
    loginUserEmail = e;
    await createUserViaPrisma(e, "password123"); // user sudah ada via Prisma

    const agent = supertest.agent(app);

    const res = await agent
      .post("/api/v1/auth/login")
      .set("Origin", ORIGIN)
      .send({ email: e, password: "password123" });

    if (res.status !== 200) {
      console.error(
        "T-A4 GAGAL endpoint=POST /api/v1/auth/login harapan=200 aktual=" +
          res.status +
          " body=" +
          JSON.stringify(res.body),
      );
    }
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.user.email).toBe(e);
    expect(res.body.data.user.passwordHash).toBeUndefined();

    const setCookie = getSetCookieArray(res);
    expect(setCookie.some((c) => c.startsWith("ec_session="))).toBe(true);

    // /me dengan agent yang sudah menyimpan ec_session dari Set-Cookie login
    const me = await agent.get("/api/v1/auth/me").set("Origin", ORIGIN);
    if (me.status !== 200) {
      console.error(
        "T-A4 GAGAL endpoint=GET /api/v1/auth/me harapan=200 aktual=" +
          me.status +
          " body=" +
          JSON.stringify(me.body),
      );
    }
    expect(me.status).toBe(200);
    expect(me.body.success).toBe(true);
    expect(me.body.data.user.email).toBe(e);
  });

  it("T-A5 login password salah 401 dan email tidak dikenal 401 (pesan generik)", async () => {
    // wrong password (pakai user T-A4 yang sudah terdaftar)
    const wrongPass = await supertest(app)
      .post("/api/v1/auth/login")
      .set("Origin", ORIGIN)
      .send({ email: loginUserEmail, password: "salah123456" });

    if (wrongPass.status !== 401) {
      console.error(
        "T-A5 GAGAL endpoint=POST /api/v1/auth/login (password salah) harapan=401 aktual=" +
          wrongPass.status +
          " body=" +
          JSON.stringify(wrongPass.body),
      );
    }
    expect(wrongPass.status).toBe(401);
    expect(wrongPass.body.success).toBe(false);
    expect(wrongPass.body.error.code).toBe("UNAUTHORIZED");
    expect(wrongPass.body.error.message).toBe("Email atau kata sandi salah");

    // email tidak dikenal
    const unknownEmail = await supertest(app)
      .post("/api/v1/auth/login")
      .set("Origin", ORIGIN)
      .send({ email: "tidak-terdaftar@example.com", password: "password123" });

    if (unknownEmail.status !== 401) {
      console.error(
        "T-A5 GAGAL endpoint=POST /api/v1/auth/login (email tidak dikenal) harapan=401 aktual=" +
          unknownEmail.status +
          " body=" +
          JSON.stringify(unknownEmail.body),
      );
    }
    expect(unknownEmail.status).toBe(401);
    expect(unknownEmail.body.success).toBe(false);
    expect(unknownEmail.body.error.code).toBe("UNAUTHORIZED");
    expect(unknownEmail.body.error.message).toBe("Email atau kata sandi salah");
  });
});

describe("GET /api/v1/auth/me", () => {
  it("T-A6 /auth/me tanpa sesi 401", async () => {
    const res = await supertest(app)
      .get("/api/v1/auth/me")
      .set("Origin", ORIGIN);

    if (res.status !== 401) {
      console.error(
        "T-A6 GAGAL endpoint=GET /api/v1/auth/me harapan=401 aktual=" +
          res.status +
          " body=" +
          JSON.stringify(res.body),
      );
    }
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });
});

describe("POST /api/v1/auth/logout", () => {
  it("T-A7 logout tanpa header CSRF 403; dengan header CSRF 200; setelah logout /auth/me 401 dan cookie sesi dibersihkan", async () => {
    const { tokenPlain, csrfToken } = await createDbSessionAndCsrf();
    const cookieHeader = `ec_csrf=${csrfToken}; ec_session=${tokenPlain}`;

    // Tanpa header CSRF → 403 (cookie ec_session dipasang lewat header Cookie)
    const noCsrf = await supertest(app)
      .post("/api/v1/auth/logout")
      .set("Origin", ORIGIN)
      .set("Cookie", `ec_session=${tokenPlain}`);
    if (noCsrf.status !== 403) {
      console.error(
        "T-A7 GAGAL endpoint=POST /api/v1/auth/logout (tanpa CSRF) harapan=403 aktual=" +
          noCsrf.status +
          " body=" +
          JSON.stringify(noCsrf.body),
      );
    }
    expect(noCsrf.status).toBe(403);
    expect(noCsrf.body.error.code).toBe("FORBIDDEN");

    // Dengan header CSRF → 200 (ec_csrf dikirim baik via cookie maupun header)
    const withCsrf = await supertest(app)
      .post("/api/v1/auth/logout")
      .set("Origin", ORIGIN)
      .set("Cookie", cookieHeader)
      .set("X-CSRF-Token", csrfToken);
    if (withCsrf.status !== 200) {
      console.error(
        "T-A7 GAGAL endpoint=POST /api/v1/auth/logout (dengan CSRF) harapan=200 aktual=" +
          withCsrf.status +
          " body=" +
          JSON.stringify(withCsrf.body),
      );
    }
    expect(withCsrf.status).toBe(200);
    expect(withCsrf.body.success).toBe(true);

    // Setelah logout: /auth/me 401 (tanpa cookie)
    const meAfter = await supertest(app)
      .get("/api/v1/auth/me")
      .set("Origin", ORIGIN);
    if (meAfter.status !== 401) {
      console.error(
        "T-A7 GAGAL endpoint=GET /api/v1/auth/me setelah logout harapan=401 aktual=" +
          meAfter.status +
          " body=" +
          JSON.stringify(meAfter.body),
      );
    }
    expect(meAfter.status).toBe(401);

    // Cookie sesi dibersihkan (clearCookie → Set-Cookie ec_session=... Max-Age=0 / Expires lalu)
    const cleared = getSetCookieArray(withCsrf).some(
      (c) =>
        c.startsWith("ec_session=") &&
        (c.includes("Max-Age=0") || c.includes("Expires=")),
    );
    expect(cleared).toBe(true);
  });
});

describe("POST /api/v1/auth/refresh", () => {
  it("T-A8 refresh merotasi token: token lama tidak valid lagi, token baru valid", async () => {
    const { userId, tokenPlain, csrfToken } = await createDbSessionAndCsrf();
    const oldToken = tokenPlain;
    const cookieHeader = `ec_csrf=${csrfToken}; ec_session=${oldToken}`;

    const refreshRes = await supertest(app)
      .post("/api/v1/auth/refresh")
      .set("Origin", ORIGIN)
      .set("Cookie", cookieHeader)
      .set("X-CSRF-Token", csrfToken);
    if (refreshRes.status !== 200) {
      console.error(
        "T-A8 GAGAL endpoint=POST /api/v1/auth/refresh harapan=200 aktual=" +
          refreshRes.status +
          " body=" +
          JSON.stringify(refreshRes.body),
      );
    }
    expect(refreshRes.status).toBe(200);
    expect(refreshRes.body.success).toBe(true);
    const newToken = extractSessionCookie(refreshRes);
    expect(newToken).toBeDefined();
    expect(newToken).not.toBe(oldToken);

    // Token lama tidak valid lagi (sudah direvoke oleh rotasi).
    const meOld = await supertest(app)
      .get("/api/v1/auth/me")
      .set("Origin", ORIGIN)
      .set("Cookie", `ec_session=${oldToken}`);
    expect(meOld.status).toBe(401);

    // Token baru valid: /auth/me 200
    const meNew = await supertest(app)
      .get("/api/v1/auth/me")
      .set("Origin", ORIGIN)
      .set("Cookie", `ec_session=${newToken}`);
    expect(meNew.status).toBe(200);
    expect(meNew.body.success).toBe(true);
    expect(meNew.body.data.user.email).toBe(
      (await prisma.user.findUnique({ where: { id: userId } }))!.email,
    );
  });
});

describe("security / token palsu", () => {
  it("T-A9 token sesi yang dipalsukan/diubah 401", async () => {
    const tampered =
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const res = await supertest(app)
      .get("/api/v1/auth/me")
      .set("Origin", ORIGIN)
      .set("Cookie", `ec_session=${tampered}`);

    if (res.status !== 401) {
      console.error(
        "T-A9 GAGAL endpoint=GET /api/v1/auth/me (token palsu) harapan=401 aktual=" +
          res.status +
          " body=" +
          JSON.stringify(res.body),
      );
    }
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });
});

describe("konkurensi refresh", () => {
  it("T-A10 konkurensi refresh: tepat satu 200, satu 401/403 (race condition)", async () => {
    const { tokenPlain, csrfToken } = await createDbSessionAndCsrf();
    const cookieHeader = `ec_csrf=${csrfToken}; ec_session=${tokenPlain}`;

    // Dua request refresh secara bersamaan dengan cookie + CSRF yang identik.
    const results = await Promise.all([
      supertest(app)
        .post("/api/v1/auth/refresh")
        .set("Origin", ORIGIN)
        .set("Cookie", cookieHeader)
        .set("X-CSRF-Token", csrfToken),
      supertest(app)
        .post("/api/v1/auth/refresh")
        .set("Origin", ORIGIN)
        .set("Cookie", cookieHeader)
        .set("X-CSRF-Token", csrfToken),
    ]);

    const ok = results.filter((r) => r.status === 200);
    const err = results.filter((r) => r.status === 401 || r.status === 403);

    if (ok.length !== 1 || err.length !== 1) {
      console.error(
        "T-A10 GAGAL endpoint=POST /api/v1/auth/refresh harapan=1x200+1x(401/403) aktual=" +
          JSON.stringify(results.map((r) => r.status)) +
          " body=" +
          JSON.stringify(results.map((r) => r.body)),
      );
    }
    expect(ok.length).toBe(1);
    expect(err.length).toBe(1);

    const newToken = extractSessionCookie(ok[0]!);
    expect(newToken).toBeDefined();
    expect(newToken).not.toBe(tokenPlain);

    // Token pemenang bisa dipakai GET /auth/me 200
    const meWin = await supertest(app)
      .get("/api/v1/auth/me")
      .set("Origin", ORIGIN)
      .set("Cookie", `ec_session=${newToken}`);
    if (meWin.status !== 200) {
      console.error(
        "T-A10 GAGAL endpoint=GET /api/v1/auth/me (token pemenang) harapan=200 aktual=" +
          meWin.status +
          " body=" +
          JSON.stringify(meWin.body),
      );
    }
    expect(meWin.status).toBe(200);
    expect(meWin.body.success).toBe(true);

    // Token lama tidak bisa dipakai lagi (direvokasi oleh rotasi yang menang)
    const meOld = await supertest(app)
      .get("/api/v1/auth/me")
      .set("Origin", ORIGIN)
      .set("Cookie", `ec_session=${tokenPlain}`);
    expect(meOld.status).toBe(401);
  });
});

describe("regresi limiter /auth/me", () => {
  it("T-A11 15 request GET /auth/me tanpa cookie: semua 401, tidak ada 429", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 15; i++) {
      const res = await supertest(app)
        .get("/api/v1/auth/me")
        .set("Origin", ORIGIN);
      statuses.push(res.status);
    }

    if (statuses.some((s) => s !== 401) || statuses.includes(429)) {
      console.error(
        "T-A11 GAGAL endpoint=GET /api/v1/auth/me harapan=semua401,tidakada429 aktual=" +
          JSON.stringify(statuses),
      );
    }
    expect(statuses.every((s) => s === 401)).toBe(true);
    expect(statuses.includes(429)).toBe(false);
  });
});
