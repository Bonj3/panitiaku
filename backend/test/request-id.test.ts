import { describe, it, expect } from "vitest";
import { createApp } from "../src/app.ts";
import supertest from "supertest";
import { REQUEST_ID_HEADER } from "../src/shared/utils/request-id.ts";

// ID yang di-generate server-side: 24 karakter heksadesimal (crypto.randomBytes).
const SERVER_ID = /^[0-9a-f]{24}$/;

describe("requestId middleware (header X-Request-Id dari klien diabaikan sepenuhnya)", () => {
  const app = createApp();

  it("tanpa header → respons menyertakan X-Request-Id yang di-generate server-side", async () => {
    const res = await supertest(app).get("/api/v1/health");

    expect(res.status).toBe(200);
    const id = res.headers[REQUEST_ID_HEADER];
    expect(typeof id).toBe("string");
    expect(SERVER_ID.test(id)).toBe(true);
  });

  it("header X-Request-Id yang 'aman' (alfanumerik/titik/underscore/strip) TIDAK di-echo; ID selalu server-side", async () => {
    const res = await supertest(app)
      .get("/api/v1/health")
      .set(REQUEST_ID_HEADER, "req-123.abc_def");

    expect(res.status).toBe(200);
    const id = res.headers[REQUEST_ID_HEADER];
    expect(typeof id).toBe("string");
    // Nilai klien tidak boleh pernah muncul sebagai ID respons (identitas).
    expect(id).not.toBe("req-123.abc_def");
    expect(SERVER_ID.test(id)).toBe(true);
  });

  it("header X-Request-Id yang berisi PII (email/token/spasi) TIDAK tercermin dalam ID respons", async () => {
    const pii = "korban@contoh.com secret-token-123";
    const res = await supertest(app)
      .get("/api/v1/health")
      .set(REQUEST_ID_HEADER, pii);

    const id = res.headers[REQUEST_ID_HEADER];
    expect(typeof id).toBe("string");
    expect(id).not.toBe(pii);
    expect(id).not.toContain("korban@contoh.com");
    expect(id).not.toContain("secret-token-123");
    expect(SERVER_ID.test(id)).toBe(true);
  });

  it("header X-Request-Id yang terlalu panjang diabaikan, digenerate server-side", async () => {
    const longId = "a".repeat(200);
    const res = await supertest(app).get("/api/v1/health").set(REQUEST_ID_HEADER, longId);

    const id = res.headers[REQUEST_ID_HEADER];
    expect(id).not.toBe(longId);
    expect(SERVER_ID.test(id)).toBe(true);
  });

  it("header X-Request-Id dengan karakter berbahaya (spasi/tanda kutip) diabaikan", async () => {
    const res = await supertest(app)
      .get("/api/v1/health")
      .set(REQUEST_ID_HEADER, '"bad; DROP TABLE logs-- x"');

    const id = res.headers[REQUEST_ID_HEADER];
    expect(id).not.toContain(";");
    expect(id).not.toContain("DROP");
    expect(SERVER_ID.test(id)).toBe(true);
  });
});
