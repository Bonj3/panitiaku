import { NextFunction, Request, Response } from "express";
import { ForbiddenError } from "../shared/errors/app-error.js";

export type EventRole = "EVENT_CHAIR" | "DIVISION_LEADER" | "MEMBER";

/**
 * Middleware factory otorisasi berbasis role membership event.
 *
 * Contoh: requireEventRole("EVENT_CHAIR") → hanya EVENT_CHAIR yang lewat.
 *
 * Catatan: Fase 4 akan menambah authorize berbasis subtree (requireSubtree);
 * subtree di sengaja BELUM diimplementasi pada fase ini. Otorisasi tetap
 * dari req.membership yang berasal dari DB (bukan dari body).
 */
export function requireEventRole(...allowedRoles: EventRole[]) {
  return function requireEventRoleMiddleware(
    req: Request,
    _res: Response,
    next: NextFunction,
  ): void {
    const role = req.membership?.role;
    if (!role || !allowedRoles.includes(role)) {
      next(new ForbiddenError("Anda tidak memiliki izin untuk melakukan tindakan ini"));
      return;
    }
    next();
  };
}
