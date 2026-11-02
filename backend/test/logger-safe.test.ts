import { describe, expect, it } from "vitest";
import {
  ForbiddenError,
  InternalServerError,
  UnprocessableError,
} from "../src/shared/errors/app-error.ts";
import { safeErrorEntry, logServerError } from "../src/shared/logger.ts";
import { ZodError } from "zod";

describe("safeErrorEntry (ringkasan error aman untuk log server)", () => {
  it("Error biasa → level error, code INTERNAL, name Error, tanpa message/stack", () => {
    const err = new Error("pesan rahasia jangan dicetak");
    err.stack = "Stack dengan rahasia";

    const entry = safeErrorEntry("req_123", err);

    expect(entry.level).toBe("error");
    expect(entry.requestId).toBe("req_123");
    expect(entry.code).toBe("INTERNAL");
    expect(entry.name).toBe("Error");
    expect(Object.keys(entry).sort()).toEqual(["code", "level", "name", "requestId"]);
    expect(entry).not.toHaveProperty("message");
    expect(entry).not.toHaveProperty("stack");
    expect(JSON.stringify(entry)).not.toContain("pesan rahasia");
    expect(JSON.stringify(entry)).not.toContain("Stack dengan rahasia");
  });

  it("tanpa requestId → field requestId dihilangkan (mis. unhandledRejection)", () => {
    const entry = safeErrorEntry(undefined, new Error("x"));
    expect(entry.requestId).toBeUndefined();
    expect(Object.keys(entry).sort()).toEqual(["code", "level", "name"]);
  });

  it("bukan Error instance → name Unknown, code INTERNAL", () => {
    const entry = safeErrorEntry("req_9", "string yang dilempar");
    expect(entry.name).toBe("Unknown");
    expect(entry.code).toBe("INTERNAL");
    expect(JSON.stringify(entry)).not.toContain("string yang dilempar");
  });

  it("AppError → code sesuai dan name class, message tidak masuk", () => {
    const entry = safeErrorEntry("req_7", new ForbiddenError("dilarang karena alasan rahasia"));
    expect(entry.code).toBe("FORBIDDEN");
    expect(entry.name).toBe("ForbiddenError");
    expect(JSON.stringify(entry)).not.toContain("dilarang");
    expect(JSON.stringify(entry)).not.toContain("rahasia");
  });

  it("InternalServerError → INTERNAL", () => {
    expect(safeErrorEntry("r", new InternalServerError("down")).code).toBe("INTERNAL");
    expect(safeErrorEntry("r", new UnprocessableError("invalid")).code).toBe("UNPROCESSABLE");
  });

  it("ZodError → UNPROCESSABLE", () => {
    const entry = safeErrorEntry("r", new ZodError([{ code: "invalid_type", expected: "string", received: "number", path: [], message: "harus string" }]));
    expect(entry.code).toBe("UNPROCESSABLE");
    expect(entry.name).toBe("ZodError");
    expect(JSON.stringify(entry)).not.toContain("harus string");
  });
});

describe("logServerError (cetak ke stderr)", () => {
  it("menulis JSON satu baris yang dapat diparse dan bebas PII/stack", () => {
    const logs: string[] = [];
    const orig = console.error;
    console.error = (...args: unknown[]) => {
      for (const a of args) if (typeof a === "string") logs.push(a);
    };
    try {
      const err = new Error("email korban@x.com dan token abc");
      err.stack = "stack rahasia";
      logServerError("req-x", err);

      expect(logs.length).toBe(1);
      const parsed = JSON.parse(logs[0]);
      expect(parsed.code).toBe("INTERNAL");
      expect(parsed.name).toBe("Error");
      expect(parsed.requestId).toBe("req-x");
      const text = JSON.stringify(parsed);
      expect(text).not.toContain("korban@x.com");
      expect(text).not.toContain("abc");
      expect(text).not.toContain("stack rahasia");
      expect(text).not.toContain("email korban@x.com dan token abc");
    } finally {
      console.error = orig;
    }
  });
});
