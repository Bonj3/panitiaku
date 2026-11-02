import { NextFunction, Request, Response } from "express";
import { prisma } from "../config/database.js";
import { hashToken } from "../shared/utils/token.js";
import { UnauthorizedError } from "../shared/errors/app-error.js";

/**
 * Middleware autentikasi sesi berdasarkan cookie `ec_session`.
 *
 * - Membaca token dari cookie (tidak pernah dari header/body).
 * - Hash token lalu cari session aktif (revokedAt null, expiresAt > now) beserta user.
 * - Gagal → 401 UNAUTHORIZED dengan pesan generik (jangan bocorkan alasan detail).
 * - Sukses → tetapkan req.user dan req.sessionToken.
 */
export async function authenticate(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  const token = req.cookies["ec_session"];
  if (typeof token !== "string" || token.length === 0) {
    next(new UnauthorizedError("Sesi tidak valid"));
    return;
  }

  const tokenHash = hashToken(token);
  const now = new Date();

  const session = await prisma.session.findUnique({
    where: { tokenHash },
    include: { user: true },
  });

  if (
    !session ||
    session.revokedAt !== null ||
    session.expiresAt <= now
  ) {
    next(new UnauthorizedError("Sesi tidak valid atau kadaluarsa"));
    return;
  }

  req.user = {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
  };
  req.sessionToken = token;

  next();
}
