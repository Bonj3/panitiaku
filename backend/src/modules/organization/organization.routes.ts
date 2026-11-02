import { Router } from "express";
import { authenticate } from "../../middleware/authenticate.js";
import { eventMembership } from "../../middleware/event-membership.js";
import { requireEventRole } from "../../middleware/require-event-role.js";
import { organizationController } from "./organization.controller.js";

/**
 * Rute organisasi event (PROJECT §13.4).
 *
 * Path dipasang di app.ts dengan prefix /api/v1/events/:eventId, sehingga
 * req.params.eventId tersedia untuk eventMembership. Router pakai mergeParams
 * agar parameter :eventId dari parent router tetap terbaca.
 *
 * Urutan middleware: authenticate → eventMembership → requireEventRole → controller.
 */
export const organizationRoutes = Router({ mergeParams: true });

// Pohon organisasi (anggota aktif semua role)
organizationRoutes.get(
  "/organization",
  authenticate,
  eventMembership,
  organizationController.getTree,
);

// Subtree anggota
organizationRoutes.get(
  "/organization/subtree/:memberId",
  authenticate,
  eventMembership,
  organizationController.getSubtree,
);

// Daftar anggota (pagination + filter)
organizationRoutes.get(
  "/members",
  authenticate,
  eventMembership,
  organizationController.listMembers,
);

// Detail anggota + parent + children
organizationRoutes.get(
  "/members/:memberId",
  authenticate,
  eventMembership,
  organizationController.getMemberDetail,
);

// Ubah status anggota (EVENT_CHAIR / DIVISION_LEADER)
organizationRoutes.patch(
  "/members/:memberId/status",
  authenticate,
  eventMembership,
  requireEventRole("EVENT_CHAIR", "DIVISION_LEADER"),
  organizationController.patchStatus,
);

// Ubah role anggota (HANYA EVENT_CHAIR)
organizationRoutes.patch(
  "/members/:memberId/role",
  authenticate,
  eventMembership,
  requireEventRole("EVENT_CHAIR"),
  organizationController.patchRole,
);

// Pindah anggota (EVENT_CHAIR / DIVISION_LEADER)
organizationRoutes.post(
  "/members/:memberId/move",
  authenticate,
  eventMembership,
  requireEventRole("EVENT_CHAIR", "DIVISION_LEADER"),
  organizationController.moveMember,
);
