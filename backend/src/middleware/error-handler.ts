import { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import multer from "multer";
import { AppError } from "../shared/errors/app-error.js";
import { Envelope, ErrorCode } from "../shared/types/http.js";
import { getRequestId } from "../shared/utils/request-id.js";
import { logServerError } from "../shared/logger.js";

function mapErrorCode(err: unknown): ErrorCode {
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

function mapStatusCode(err: unknown): number {
  if (err instanceof AppError) {
    return err.statusCode;
  }
  if (err instanceof ZodError) {
    return 422;
  }
  if (err instanceof multer.MulterError) {
    return err.code === "LIMIT_FILE_SIZE" ? 413 : 422;
  }
  return 500;
}

function buildDetails(err: unknown): Record<string, unknown> {
  if (err instanceof AppError) {
    return err.details;
  }
  if (err instanceof ZodError) {
    // Zod v4 menyimpan detail validasi di `.issues` (bukan `.errors` seperti v3).
    return {
      fields: err.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    };
  }
  return {};
}

function buildMessage(err: unknown): string {
  if (err instanceof AppError) {
    return err.message;
  }
  if (err instanceof ZodError) {
    return "Validasi gagal";
  }
  return "Terjadi kesalahan internal server";
}

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
   
  _next: NextFunction
): void {
  const statusCode = mapStatusCode(err);
  const code = mapErrorCode(err);

  const envelope: Envelope = {
    success: false,
    error: {
      code,
      message: buildMessage(err),
      details: buildDetails(err),
    },
  };

  // Log terstruktur dan aman di server (hanya outside production): requestId
  // untuk korelasi + code/name saja. Message, stack, input, URL, token, dan
  // PII TIDAK pernah dicetak. Detail untuk klien tetap lewat envelope di atas.
  if (process.env.NODE_ENV !== "production") {
    logServerError(getRequestId(req), err);
  }

  res.status(statusCode).json(envelope);
}
