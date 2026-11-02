import rateLimit from "express-rate-limit";
import { Router } from "express";
import { authenticate } from "../../middleware/authenticate.js";
import { authController } from "./auth.controller.js";

/**
 * Rate limit ketat HANYA untuk endpoint kredensial (login/register/refresh).
 *
 * Penting: jangan pasang limiter ini di level router. `GET /auth/me` dipanggil
 * pada setiap pemuatan halaman oleh frontend, sehingga limiter 10 req/menit di
 * seluruh router akan membuat aplikasi terkena 429 saat penggunaan normal.
 * Endpoint baca sesi (`/me`) dan logout cukup memakai limiter global di app.ts.
 */
export const credentialRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: {
      code: "RATE_LIMITED",
      message:
        "Terlalu banyak permintaan ke endpoint autentikasi, coba lagi nanti.",
    },
  },
});

/** Longgar khusus /auth/me: cukup untuk mencegah scraping tanpa mengganggu UI. */
export const sessionProbeRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: {
      code: "RATE_LIMITED",
      message: "Terlalu banyak permintaan, coba lagi nanti.",
    },
  },
});

export const authRoutes = Router();

// Endpoint publik (belum memiliki sesi): CSRF header dikecualikan secara
// global oleh middleware csrf, yang juga memeriksa Origin/Referer.
authRoutes.post("/register", credentialRateLimiter, authController.register);
authRoutes.post("/login", credentialRateLimiter, authController.login);
authRoutes.post("/refresh", credentialRateLimiter, authController.refresh);

// Endpoint yang memerlukan sesi aktif + token CSRF pada mutasi.
authRoutes.post("/logout", authenticate, authController.logout);
authRoutes.get("/me", sessionProbeRateLimiter, authenticate, authController.me);
