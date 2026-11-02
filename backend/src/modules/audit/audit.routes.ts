import { Router } from "express";
import { authenticate } from "../../middleware/authenticate.js";
import { eventMembership } from "../../middleware/event-membership.js";
import { requireEventRole } from "../../middleware/require-event-role.js";
import { auditController } from "./audit.controller.js";

/**
 * Rute audit log (PROJECT §8.2, §13.6, BR-13).
 *
 * Hanya EVENT_CHAIR yang boleh membaca audit log event. Semua otorisasi di
 * backend. Urutan middleware: authenticate → eventMembership →
 * requireEventRole(EVENT_CHAIR) → controller.
 */
export const auditRoutes = Router({ mergeParams: true });

auditRoutes.get(
  "/audit-logs",
  authenticate,
  eventMembership,
  requireEventRole("EVENT_CHAIR"),
  auditController.list,
);
