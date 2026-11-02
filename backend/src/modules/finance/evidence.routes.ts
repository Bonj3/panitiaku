import { Router } from "express";
import { authenticate } from "../../middleware/authenticate.js";
import { eventMembership } from "../../middleware/event-membership.js";
import { csrf } from "../../middleware/csrf.js";
import { multerUpload } from "../../shared/multer.js";
import { evidenceController } from "./evidence.controller.js";

/**
 * Rute bukti transaksi (PROJECT §5.C, §13.6, BR-12, BR-13).
 *
 * Dipasang di app.ts dengan prefix /api/v1/events/:eventId/transactions/:txId,
 * sehingga req.params.eventId dan req.params.txId tersedia. Router pakai
 * mergeParams.
 *
 * Urutan middleware: authenticate → eventMembership → csrf → multer → controller.
 * Semua otorisasi di backend (tidak pernah percaya role dari body).
 */
export const evidenceRoutes = Router({ mergeParams: true });

// GET — daftar metadata bukti untuk transaksi
evidenceRoutes.get(
  "/",
  authenticate,
  eventMembership,
  evidenceController.list
);

// POST — unggah bukti (multipart, field 'file', optional boolean isPaymentProof)
evidenceRoutes.post(
  "/",
  authenticate,
  eventMembership,
  csrf,
  multerUpload.single("file"),
  evidenceController.upload
);

// GET — signed URL (semua anggota aktif event)
evidenceRoutes.get(
  "/:evidenceId/url",
  authenticate,
  eventMembership,
  evidenceController.getUrl
);

// PATCH — ubah flag sensitive (HANYA Chair)
evidenceRoutes.patch(
  "/:evidenceId/sensitive",
  authenticate,
  eventMembership,
  csrf,
  evidenceController.updateSensitive
);
