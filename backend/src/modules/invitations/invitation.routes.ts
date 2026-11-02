import { Router } from "express";
import { authenticate } from "../../middleware/authenticate.js";
import { eventMembership } from "../../middleware/event-membership.js";
import { requireEventRole } from "../../middleware/require-event-role.js";
import { invitationController } from "./invitation.controller.js";

/**
 * Rute undangan berbasis event (PROJECT §13.4).
 *
 * Dipasang di app.ts dengan prefix /api/v1/events/:eventId/invitations,
 * sehingga req.params.eventId tersedia untuk eventMembership. Router pakai
 * mergeParams agar parameter :eventId dari parent router tetap terbaca.
 *
 * Urutan middleware: authenticate → eventMembership → requireEventRole → controller.
 */
export const invitationRoutes = Router({ mergeParams: true });

// Buat undangan (EVENT_CHAIR / DIVISION_LEADER)
invitationRoutes.post(
  "/",
  authenticate,
  eventMembership,
  requireEventRole("EVENT_CHAIR", "DIVISION_LEADER"),
  invitationController.create,
);

// Daftar undangan (EVENT_CHAIR / DIVISION_LEADER)
invitationRoutes.get(
  "/",
  authenticate,
  eventMembership,
  requireEventRole("EVENT_CHAIR", "DIVISION_LEADER"),
  invitationController.list,
);

// Batalkan undangan (EVENT_CHAIR / DIVISION_LEADER)
invitationRoutes.post(
  "/:invitationId/revoke",
  authenticate,
  eventMembership,
  requireEventRole("EVENT_CHAIR", "DIVISION_LEADER"),
  invitationController.revoke,
);
