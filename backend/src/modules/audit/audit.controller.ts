import { Request, Response } from "express";
import { z } from "zod";
import { NotFoundError, UnauthorizedError } from "../../shared/errors/app-error.js";
import { listAuditLogs } from "./audit.service.js";
import { auditLogsQuerySchema, type AuditLogsQuery } from "./audit.validator.js";

function parseUuidParam(req: Request, name: string): string {
  const v = req.params[name];
  if (typeof v !== "string" || !z.string().uuid().safeParse(v).success) {
    throw new NotFoundError("Resource tidak ditemukan");
  }
  return v;
}

export const auditController = {
  async list(req: Request, res: Response): Promise<void> {
    const eventId = parseUuidParam(req, "eventId");
    const membership = req.membership;
    if (!membership) {
      throw new UnauthorizedError("Keanggotaan event tidak tersedia");
    }
    const input = auditLogsQuerySchema.parse(req.query) as AuditLogsQuery;
    const data = await listAuditLogs(eventId, input);
    res.status(200).json({ success: true, data: { items: data.items, meta: data.meta } });
  },
};
