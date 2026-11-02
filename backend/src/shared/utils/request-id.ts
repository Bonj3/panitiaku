import { randomBytes } from "node:crypto";
import { Request, Response, NextFunction } from "express";

const REQUEST_ID_HEADER = "x-request-id";

/**
 * Hasilkan ID permintaan di sisi server dengan crypto.randomBytes.
 * ID ini tidak pernah berasal dari input klien mentah (header X-Request-Id
 * diabaikan sepenuhnya untuk identitas, karena header tersebut mungkin
 * mengandung PII/token klien).
 */
function generateRequestId(): string {
  return randomBytes(12).toString("hex");
}

export function getRequestId(req: Request): string {
  // ID diset oleh requestIdMiddleware; fallback generate bila tidak ada
  // konteks permintaan (mis. error handler tanpa req).
  return (req.requestId ?? generateRequestId()) as string;
}

export function setRequestId(req: Request, id: string): void {
  req.requestId = id;
}

/**
 * Middleware: buat ID permintaan di sisi server dan echo ke response header.
 *
 * Header X-Request-Id dari klien TIDAK dibaca, TIDAK divalidasi, dan TIDAK
 * di-echo ke respons, mencegah PII/token dari klien bocor ke log maupun
 * response. Identitas permintaan selalu bernilai server-side.
 */
export const requestIdMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const id = generateRequestId();
  setRequestId(req, id);
  res.setHeader(REQUEST_ID_HEADER, id);
  next();
};

export { REQUEST_ID_HEADER };
