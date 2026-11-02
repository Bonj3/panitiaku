import { Request, Response } from "express";
import { z } from "zod";
import { NotFoundError } from "../../shared/errors/app-error.js";
import {
  listMembersQuerySchema,
  updateStatusSchema,
  updateRoleSchema,
  moveSchema,
  type ListMembersQuery,
  type UpdateStatusInput,
  type UpdateRoleInput,
  type MoveInput,
} from "./organization.validator.js";
import {
  getTree,
  getSubtree,
  listMembers,
  getMemberDetail,
  updateStatus,
  updateRole,
  moveMember,
} from "./organization.service.js";

function parseUuidParam(req: Request, name: string): string {
  const v = req.params[name];
  if (typeof v !== "string" || !z.string().uuid().safeParse(v).success) {
    throw new NotFoundError("Resource tidak ditemukan");
  }
  return v;
}

export const organizationController = {
  async getTree(req: Request, res: Response): Promise<void> {
    const eventId = parseUuidParam(req, "eventId");
    const data = await getTree(eventId);
    res.status(200).json({ success: true, data });
  },

  async getSubtree(req: Request, res: Response): Promise<void> {
    const eventId = parseUuidParam(req, "eventId");
    const memberId = parseUuidParam(req, "memberId");
    const data = await getSubtree(eventId, memberId);
    res.status(200).json({ success: true, data });
  },

  async listMembers(req: Request, res: Response): Promise<void> {
    const eventId = parseUuidParam(req, "eventId");
    const input = listMembersQuerySchema.parse(req.query) as ListMembersQuery;
    const data = await listMembers(eventId, input);
    res.status(200).json({ success: true, data, meta: data.meta });
  },

  async getMemberDetail(req: Request, res: Response): Promise<void> {
    const eventId = parseUuidParam(req, "eventId");
    const memberId = parseUuidParam(req, "memberId");
    const data = await getMemberDetail(eventId, memberId);
    res.status(200).json({ success: true, data });
  },

  async patchStatus(req: Request, res: Response): Promise<void> {
    const eventId = parseUuidParam(req, "eventId");
    const memberId = parseUuidParam(req, "memberId");
    const input = updateStatusSchema.parse(req.body) as UpdateStatusInput;
    const membership = req.membership;
    if (!membership) {
      throw new Error("Keanggotaan event tidak tersedia");
    }
    const data = await updateStatus(eventId, membership, memberId, input.status);
    res.status(200).json({ success: true, data });
  },

  async patchRole(req: Request, res: Response): Promise<void> {
    const eventId = parseUuidParam(req, "eventId");
    const memberId = parseUuidParam(req, "memberId");
    const input = updateRoleSchema.parse(req.body) as UpdateRoleInput;
    const membership = req.membership;
    if (!membership) {
      throw new Error("Keanggotaan event tidak tersedia");
    }
    const data = await updateRole(eventId, membership, memberId, input.role);
    res.status(200).json({ success: true, data });
  },

  async moveMember(req: Request, res: Response): Promise<void> {
    const eventId = parseUuidParam(req, "eventId");
    const memberId = parseUuidParam(req, "memberId");
    const input = moveSchema.parse(req.body) as MoveInput;
    const membership = req.membership;
    if (!membership) {
      throw new Error("Keanggotaan event tidak tersedia");
    }
    const data = await moveMember(eventId, membership, memberId, input.newParentId);
    res.status(200).json({ success: true, data });
  },
};
