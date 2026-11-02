import rateLimit from "express-rate-limit";
import { Router } from "express";
import { authenticate } from "../../middleware/authenticate.js";
import { invitationController } from "./invitation.controller.js";

/**
 * Rate limit untuk endpoint publik undangan (30 permintaan/menit/IP).
 * Tidak memerlukan autentikasi.
 */
export const publicInvitationRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: {
      code: "RATE_LIMITED",
      message: "Terlalu banyak permintaan ke endpoint undangan, coba lagi nanti.",
    },
  },
});

/**
 * Rute undangan publik (tanpa autentikasi session).
 *
 * Dipasang di app.ts dengan prefix /api/v1/invitations.
 *
 * - GET /:token → detail undangan (publik, rate-limited, tanpa email/PII)
 * - POST /:token/accept → terima undangan (butuh sesi aktif + CSRF global)
 */
export const invitationPublicRoutes = Router();

// Detail undangan publik (buka, rate-limited)
invitationPublicRoutes.get(
  "/:token",
  publicInvitationRateLimiter,
  invitationController.publicDetail,
);

// Terima undangan (butuh sesi; CSRF global berlaku pada POST)
invitationPublicRoutes.post(
  "/:token/accept",
  publicInvitationRateLimiter,
  authenticate,
  invitationController.accept,
);
