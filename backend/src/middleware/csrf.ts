import { NextFunction, Request, Response } from "express";
import { randomBytes } from "node:crypto";
import { env } from "../config/env.js";
import { ForbiddenError } from "../shared/errors/app-error.js";
import { constantTimeCompare } from "../shared/utils/token.js";

const CSRF_COOKIE_NAME = "ec_csrf";
const CSRF_HEADER_NAME = "x-csrf-token"; // node.js lowercase-kan semua nama header req
const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

// Endpoint autentikasi publik yang belum memiliki sesi: dikecualikan dari
// pemeriksaan header double-submit, tapi tetap memerlukan Origin/Referer yang
// terdaftar di allowlist CORS_ORIGIN.
const CSRF_EXEMPT_PATHS = [
  "/api/v1/auth/register",
  "/api/v1/auth/login",
  "/api/v1/auth/refresh",
];

const allowedOrigins = env.CORS_ORIGIN
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

/**
 * Jalur lengkap request, karena `req.path` dipotong oleh Express saat middleware
 * dijalankan dalam sub-router (baseUrl terpasang), sementara di level aplikasi
 * `req.path` sudah lengkap. Menggabungkan keduanya membuat pengecekan jalur
 * kecuali konsisten di keduanya.
 */
function fullPath(req: Request): string {
  return ((req.baseUrl ?? "") + req.path).replace(/\/+/g, "/");
}

function parseOrigin(header: string | undefined): string | null {
  if (!header) {
    return null;
  }
  try {
    return new URL(header).origin;
  } catch {
    return null;
  }
}

function isAllowedOrigin(origin: string | null): boolean {
  return origin !== null && allowedOrigins.includes(origin);
}

function generateCsrfToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * Middleware CSRF double-submit.
 *
 * - Setiap respons mendapatkan cookie `ec_csrf` (httpOnly false, sameSite lax)
 *   berisi token acak, bila cookie belum ada di request.
 * - Untuk metode mutasi (POST/PUT/PATCH/DELETE) wajib menyertakan header
 *   `X-CSRF-Token` yang sama dengan nilai cookie; selain itu → 403 FORBIDDEN.
 * - Endpoint auth publik dikecualikan dari header namun tetap divalidasi
 *   Origin/Referer-nya terhadap CORS_ORIGIN allowlist.
 */
export function csrf(req: Request, res: Response, next: NextFunction): void {
  if (!req.cookies[CSRF_COOKIE_NAME]) {
    res.cookie(CSRF_COOKIE_NAME, generateCsrfToken(), {
      httpOnly: false,
      sameSite: "lax",
      path: "/",
      secure: env.NODE_ENV === "production",
    });
  }

  if (!MUTATING_METHODS.has(req.method)) {
    next();
    return;
  }

  const isExempt = CSRF_EXEMPT_PATHS.includes(fullPath(req));
  if (isExempt) {
    const origin = parseOrigin(
      typeof req.headers.origin === "string" ? req.headers.origin : undefined,
    );
    const referer = parseOrigin(
      typeof req.headers.referer === "string" ? req.headers.referer : undefined,
    );
    if (!isAllowedOrigin(origin) && !isAllowedOrigin(referer)) {
      next(new ForbiddenError("Origin tidak diizinkan"));
      return;
    }
    next();
    return;
  }

  const cookieToken = req.cookies[CSRF_COOKIE_NAME];
  const headerValues = req.headers[CSRF_HEADER_NAME];
  const headerValue = Array.isArray(headerValues)
    ? headerValues[0]
    : headerValues;

  if (
    typeof cookieToken !== "string" ||
    typeof headerValue !== "string" ||
    !constantTimeCompare(cookieToken, headerValue)
  ) {
    next(new ForbiddenError("Token CSRF tidak valid"));
    return;
  }

  next();
}
