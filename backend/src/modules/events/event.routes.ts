import { Router } from "express";
import { authenticate } from "../../middleware/authenticate.js";
import { eventMembership } from "../../middleware/event-membership.js";
import { requireEventRole } from "../../middleware/require-event-role.js";
import { eventController } from "./event.controller.js";

/**
 * Rute event (PROJECT §13.3). Tidak ada GET /events list — picker
 * mengakses daftar event melalui /api/v1/auth/me (memberships).
 *
 * Urutan middleware penting: authenticate → eventMembership →
 * requireEventRole → controller. Semua otorisasi di backend.
 */
export const eventRoutes = Router();

eventRoutes.post("/", authenticate, eventController.create);

eventRoutes.get("/:eventId", authenticate, eventMembership, eventController.getDetail);

eventRoutes.patch(
  "/:eventId",
  authenticate,
  eventMembership,
  requireEventRole("EVENT_CHAIR"),
  eventController.update,
);

eventRoutes.post(
  "/:eventId/close",
  authenticate,
  eventMembership,
  requireEventRole("EVENT_CHAIR"),
  eventController.close,
);
