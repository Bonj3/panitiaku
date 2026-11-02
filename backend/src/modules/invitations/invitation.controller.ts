import { Request, Response } from "express";
import { z } from "zod";
import { NotFoundError } from "../../shared/errors/app-error.js";
import {
  createInvitationSchema,
  listInvitationsQuerySchema,
  type CreateInvitationInput,
  type ListInvitationsQuery,
} from "./invitation.validator.js";
import {
  createInvitation,
  listInvitations,
  getPublicDetail,
  acceptInvitation,
  revokeInvitation,
} from "./invitation.service.js";

function parseUuidParam(req: Request, name: string): string {
  const v = req.params[name];
  if (typeof v !== "string" || !z.string().uuid().safeParse(v).success) {
    throw new NotFoundError("Resource tidak ditemukan");
  }
  return v;
}

export const invitationController = {
  async create(req: Request, res: Response): Promise<void> {
    const eventId = parseUuidParam(req, "eventId");
    const input = createInvitationSchema.parse(
      req.body,
    ) as CreateInvitationInput;
    const membership = req.membership;
    if (!membership) {
      throw new Error("Keanggotaan event tidak tersedia");
    }
    const data = await createInvitation(eventId, membership, input);
    res.status(201).json({ success: true, data });
  },

  async list(req: Request, res: Response): Promise<void> {
    const eventId = parseUuidParam(req, "eventId");
    const input = listInvitationsQuerySchema.parse(
      req.query,
    ) as ListInvitationsQuery;
    const membership = req.membership;
    if (!membership) {
      throw new Error("Keanggotaan event tidak tersedia");
    }
    const data = await listInvitations(eventId, membership, input);
    res.status(200).json({ success: true, data, meta: data.meta });
  },

  async revoke(req: Request, res: Response): Promise<void> {
    const eventId = parseUuidParam(req, "eventId");
    const invitationId = parseUuidParam(req, "invitationId");
    const membership = req.membership;
    if (!membership) {
      throw new Error("Keanggotaan event tidak tersedia");
    }
    const data = await revokeInvitation(eventId, membership, invitationId);
    res.status(200).json({ success: true, data });
  },

  async publicDetail(req: Request, res: Response): Promise<void> {
    const token = req.params.token;
    if (typeof token !== "string" || token.length === 0) {
      throw new NotFoundError("Undangan tidak ditemukan");
    }
    const data = await getPublicDetail(token);
    res.status(200).json({ success: true, data });
  },

  async accept(req: Request, res: Response): Promise<void> {
    const token = req.params.token;
    if (typeof token !== "string" || token.length === 0) {
      throw new NotFoundError("Undangan tidak ditemukan");
    }
    const user = req.user;
    if (!user) {
      throw new Error("Sesi tidak tersedia");
    }
    const data = await acceptInvitation(token, user);
    res.status(201).json({ success: true, data });
  },
};
