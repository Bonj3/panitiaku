import { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../config/database.js";
import { ForbiddenError, NotFoundError } from "../shared/errors/app-error.js";
import type { EventSummary } from "../shared/types/http.js";

const uuidSchema = z.string().uuid();

/**
 * Middleware keanggotaan event. Harus dipasang SETELAH `authenticate`.
 *
 * - Validasi req.params.eventId harus UUID (invalid → 404 generik, jangan
 *   bocorken detail ID).
 * - Cari event (id, name, slug, status) dan membership user pada event itu
 *   (status apa pun).
 * - Event tidak ada → 404 NOT_FOUND.
 * - Membership tidak ada atau status != ACTIVE → 403 FORBIDDEN
 *   "Anda bukan anggota aktif event ini" (BR-01).
 * - Sukses: tetapkan req.event dan req.membership. Controller tidak perlu
 *   query ulang.
 */
export async function eventMembership(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  const rawEventId = req.params.eventId;
  const eventId = typeof rawEventId === "string" ? rawEventId : undefined;

  if (!eventId || !uuidSchema.safeParse(eventId).success) {
    next(new NotFoundError("Event tidak ditemukan"));
    return;
  }

  const userId = req.user?.id;
  if (!userId) {
    next(new ForbiddenError("Anda bukan anggota aktif event ini"));
    return;
  }

  const [event, membership] = await Promise.all([
    prisma.event.findUnique({
      where: { id: eventId },
      select: { id: true, name: true, slug: true, status: true },
    }),
    prisma.eventMember.findFirst({
      where: { eventId, userId },
      select: { id: true, eventId: true, userId: true, role: true, status: true },
    }),
  ]);

  if (!event) {
    next(new NotFoundError("Event tidak ditemukan"));
    return;
  }

  if (!membership || membership.status !== "ACTIVE") {
    next(new ForbiddenError("Anda bukan anggota aktif event ini"));
    return;
  }

  const eventSummary: EventSummary = {
    id: event.id,
    name: event.name,
    slug: event.slug,
    status: event.status as "OPEN" | "CLOSED",
  };

  req.event = eventSummary;
  req.membership = {
    id: membership.id,
    eventId: membership.eventId,
    userId: membership.userId,
    role: membership.role as "EVENT_CHAIR" | "DIVISION_LEADER" | "MEMBER",
    status: membership.status as "ACTIVE" | "INACTIVE",
    event: eventSummary,
  };

  next();
}
