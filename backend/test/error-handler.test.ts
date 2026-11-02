import { afterEach, describe, it, expect, vi } from "vitest";
import express, { NextFunction, Request, Response } from "express";
import { z } from "zod";
import supertest from "supertest";
import { errorHandler } from "../src/middleware/error-handler.ts";
import { ForbiddenError } from "../src/shared/errors/app-error.ts";

describe("errorHandler (ZodError)", () => {
  const app = express();
  app.use(express.json());

  app.post("/validate", (_req: Request, res: Response, next: NextFunction) => {
    const schema = z.object({ email: z.string().email() });
    try {
      schema.parse({ email: "not-an-email" });
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  app.use(errorHandler);

  it("ZodError -> 422 envelope UNPROCESSABLE dengan details.fields", async () => {
    const res = await supertest(app)
      .post("/validate")
      .send({ email: "not-an-email" });

    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe("UNPROCESSABLE");
    expect(res.body.error.message).toBe("Validasi gagal");

    expect(res.body.error.details).toBeDefined();
    expect(Array.isArray(res.body.error.details.fields)).toBe(true);
    expect(res.body.error.details.fields.length).toBeGreaterThan(0);

    const fieldError = res.body.error.details.fields.find(
      (f: { path: string }) => f.path === "email"
    );
    expect(fieldError).toBeDefined();
    expect(fieldError!.message).toContain("email");
  });
});

describe("errorHandler structured safe logging", () => {
  let spy: ReturnType<typeof vi.spyOn>;

  afterEach(() => {
    spy.mockRestore();
  });

  function appWithError(errToThrow: unknown) {
    const app = express();
    app.use(express.json());
    app.post("/boom", (_req: Request, res: Response, next: NextFunction) => {
      next(errToThrow);
    });
    app.use(errorHandler);
    return app;
  }

  it("mencatat requestId + code + name saja; TIDAK mencetak message/stack/PII/URL/token", async () => {
    const piiMessage =
      "Gagal memproses: email user@example.com, token secret-token-123, URL https://internal.example.com/admin?token=secret";
    const err = new Error(piiMessage);
    err.stack = "Error: " + piiMessage + "\n    at boom (file.js:10:5)";

    spy = vi.spyOn(console, "error").mockImplementation(() => {});

    const app = appWithError(err);
    const res = await supertest(app).post("/boom");

    // Envelope ke klien: tidak ada stack, pesan aman/general.
    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe("INTERNAL");
    expect(res.body.error.message).toBe("Terjadi kesalahan internal server");
    expect(res.body.error).not.toHaveProperty("stack");
    expect(res.body.error.details).toEqual({});

    // Log server terstruktur.
    expect(spy).toHaveBeenCalledTimes(1);
    const logged = JSON.parse(spy.mock.calls[0][0] as string);
    expect(logged.level).toBe("error");
    expect(typeof logged.requestId).toBe("string");
    expect(logged.requestId.length).toBeGreaterThan(0);
    expect(logged.code).toBe("INTERNAL");
    expect(logged.name).toBe("Error");

    const loggedText = JSON.stringify(logged);
    expect(loggedText).not.toContain(piiMessage);
    expect(loggedText).not.toContain("user@example.com");
    expect(loggedText).not.toContain("secret-token-123");
    expect(loggedText).not.toContain("internal.example.com");
    expect(loggedText).not.toContain("stack");
    expect(Object.keys(logged).sort()).toEqual(["code", "level", "name", "requestId"]);
  });

  it("AppError cocokkan code/name tanpa menyisipkan message ke log", async () => {
    spy = vi.spyOn(console, "error").mockImplementation(() => {});

    const app = appWithError(new ForbiddenError("Tidak berhak melihat detail anggota X"));
    const res = await supertest(app).post("/boom");

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");

    expect(spy).toHaveBeenCalledTimes(1);
    const logged = JSON.parse(spy.mock.calls[0][0] as string);
    expect(logged.code).toBe("FORBIDDEN");
    expect(logged.name).toBe("ForbiddenError");
    expect(JSON.stringify(logged)).not.toContain("Tidak berhak");
    expect(JSON.stringify(logged)).not.toContain("detail anggota X");
  });

  it("tidak mencetak log ke server bila NODE_ENV = production", async () => {
    spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      const app = appWithError(new Error("rahasia produksi jangan dicetak"));
      await supertest(app).post("/boom");
      expect(spy).not.toHaveBeenCalled();
    } finally {
      process.env.NODE_ENV = originalEnv;
    }
  });
});
