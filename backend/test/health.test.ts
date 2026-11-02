import { describe, it, expect } from "vitest";
import { createApp } from "../src/app.ts";
import supertest from "supertest";

describe("GET /api/v1/health", () => {
  const app = createApp();

  it("mengembalikan 200, envelope sukses { status: 'ok' }, dan header X-Request-Id", async () => {
    const res = await supertest(app).get("/api/v1/health");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      data: { status: "ok" },
    });

    const requestId = res.headers["x-request-id"];
    expect(requestId).toBeDefined();
    expect(typeof requestId).toBe("string");
    expect((requestId as string).length).toBeGreaterThan(0);
  });

  it("route yang tidak diketahui -> 404 envelope { success:false, error:{ code:'NOT_FOUND' } }", async () => {
    const res = await supertest(app).get("/api/v1/tidak-ada");

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({
      success: false,
      error: { code: "NOT_FOUND" },
    });
  });

  it("body tidak mengandung stack trace saat NODE_ENV=test", async () => {
    expect(process.env.NODE_ENV).toBe("test");

    const res = await supertest(app).get("/api/v1/health");
    const body = JSON.stringify(res.body);

    expect(body).not.toContain("stack");
    expect(body).not.toContain("Stack");
  });
});
