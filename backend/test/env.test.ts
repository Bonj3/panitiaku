import { describe, it, expect } from "vitest";
import { parseCorsOrigin, validateCorsOrigin } from "../src/config/env.ts";

describe("parseCorsOrigin (uraikan CORS_ORIGIN ke daftar origin)", () => {
  it("memisahkan per koma, trim, dan abaikan string kosong", () => {
    expect(parseCorsOrigin("http://localhost:5173, https://app.example.com ")).toEqual([
      "http://localhost:5173",
      "https://app.example.com",
    ]);
    expect(parseCorsOrigin(" , , ")).toEqual([]);
  });
});

describe("validateCorsOrigin (tolak wildcard '*' saat boot)", () => {
  it("tolak CORS_ORIGIN='*' (wildcard tidak diizinkan bersama credentials)", () => {
    expect(() => validateCorsOrigin(["*"])).toThrow(/CORS_ORIGIN.*wildcard/);
  });

  it("tolak allowlist yang mengandung '*' di tengah daftar", () => {
    expect(() =>
      validateCorsOrigin(["http://localhost:5173", "*"])
    ).toThrow(/wildcard/);
  });

  it("terima allowlist origin eksplisit tanpa wildcard", () => {
    expect(() => validateCorsOrigin(["http://localhost:5173"])).not.toThrow();
    expect(() =>
      validateCorsOrigin(["http://localhost:5173", "https://app.example.com"])
    ).not.toThrow();
    expect(() => validateCorsOrigin([])).not.toThrow();
  });
});
