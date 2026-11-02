/**
 * Tipe envelope API sesuai PROJECT.md §13.1.
 *
 * Sukses:  { success: true, data: T, meta?: PaginationMeta }
 * Error:   { success: false, error: { code, message, details } }
 */

export type ErrorCode =
  | "BAD_REQUEST"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "UNPROCESSABLE"
  | "GONE"
  | "RATE_LIMITED"
  | "INTERNAL";

export interface PaginationMeta {
  page: number;
  perPage: number;
  total: number;
}

export interface SuccessEnvelope<T> {
  success: true;
  data: T;
  meta?: PaginationMeta;
}

export interface ApiErrorBody {
  code: ErrorCode | string;
  message: string;
  details?: unknown;
}

export interface ErrorEnvelope {
  success: false;
  error: ApiErrorBody;
}

export type Envelope<T> = SuccessEnvelope<T> | ErrorEnvelope;
