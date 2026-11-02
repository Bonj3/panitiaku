import multer from "multer";
import { ZodError } from "zod";
import { AppError } from "../shared/errors/app-error.js";
import type { ErrorCode } from "../shared/types/http.js";

export interface SafeErrorLogEntry {
  level: "error";
  requestId?: string;
  code: ErrorCode;
  name: string;
}

/**
 * Kode error untuk log server (tidak mengandung pesan error apa pun).
 * Pemetaan sama dengan error-handler agar log dan envelope konsisten.
 */
function errorCode(err: unknown): ErrorCode {
  if (err instanceof AppError) {
    return err.code;
  }
  if (err instanceof ZodError) {
    return "UNPROCESSABLE";
  }
  if (err instanceof multer.MulterError) {
    return err.code === "LIMIT_FILE_SIZE" ? "BAD_REQUEST" : "UNPROCESSABLE";
  }
  return "INTERNAL";
}

/**
 * Nama error untuk log. `instanceof Error` tidak cukup di Zod v4
 * (`ZodError` bukan subclass Error meski memiliki `.name`), sehingga tangani
 * keduanya. Tidak pernah mengembalikan message/stack.
 */
function errorName(err: unknown): string {
  if (err instanceof Error) {
    return err.name;
  }
  if (
    err !== null &&
    typeof err === "object" &&
    typeof (err as Record<string, unknown>).name === "string"
  ) {
    return (err as Record<string, unknown>).name as string;
  }
  return "Unknown";
}

/**
 * Ringkasan AMAN dari error untuk dicatat ke log server.
 *
 * Hanya memuat: `level`, `requestId` (korelasi via X-Request-Id bila tersedia),
 * `code` (kode error envelope), dan `name` (nama class Error).
 *
 * SENGaja TIDAK memuat: `message`, `stack`, input/body request, URL,
 * header, token, cookie, atau PII apa pun. Detail yang dimaksudkan untuk
 * klien tetap dikirim melalui envelope error-handler (kode + message yang
 * telah disaring + details aman), bukan lewat log ini.
 *
 * @param requestId nilai `req.requestId` (diset requestIdMiddleware); undefined
 *        bila tidak ada konteks permintaan (mis. unhandledRejection).
 */
export function safeErrorEntry(
  requestId: string | undefined,
  err: unknown,
): SafeErrorLogEntry {
  const entry: SafeErrorLogEntry = {
    level: "error",
    code: errorCode(err),
    name: errorName(err),
  };
  if (requestId) {
    entry.requestId = requestId;
  }
  return entry;
}

/**
 * Cetak entri error aman sebagai satu baris JSON ke stderr.
 * Tidak ada PII/rahasia/stack yang tercetak.
 */
export function logServerError(requestId: string | undefined, err: unknown): void {
  console.error(JSON.stringify(safeErrorEntry(requestId, err)));
}

export { errorCode };
