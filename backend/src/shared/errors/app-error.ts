export type AppErrorCode =
  | "BAD_REQUEST"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "UNPROCESSABLE"
  | "GONE"
  | "RATE_LIMITED"
  | "INTERNAL";

export interface AppErrorOptions {
  details?: Record<string, unknown>;
  cause?: Error;
}

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: AppErrorCode;
  public readonly details: Record<string, unknown>;
  public readonly isOperational: boolean;

  constructor(
    code: AppErrorCode,
    statusCode: number,
    message: string,
    options: AppErrorOptions = {}
  ) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.code = code;
    this.details = options.details ?? {};
    this.isOperational = true;

    if (options.cause) {
      this.cause = options.cause;
    }

    Error.captureStackTrace(this, this.constructor);
  }
}

export class BadRequestError extends AppError {
  constructor(message: string, options?: AppErrorOptions) {
    super("BAD_REQUEST", 400, message, options);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message: string, options?: AppErrorOptions) {
    super("UNAUTHORIZED", 401, message, options);
  }
}

export class ForbiddenError extends AppError {
  constructor(message: string, options?: AppErrorOptions) {
    super("FORBIDDEN", 403, message, options);
  }
}

export class NotFoundError extends AppError {
  constructor(message: string, options?: AppErrorOptions) {
    super("NOT_FOUND", 404, message, options);
  }
}

export class ConflictError extends AppError {
  constructor(message: string, options?: AppErrorOptions) {
    super("CONFLICT", 409, message, options);
  }
}

export class UnprocessableError extends AppError {
  constructor(message: string, options?: AppErrorOptions) {
    super("UNPROCESSABLE", 422, message, options);
  }
}

export class GoneError extends AppError {
  constructor(message: string, options?: AppErrorOptions) {
    super("GONE", 410, message, options);
  }
}

export function appErrorFromError(error: unknown): AppError {
  if (error instanceof AppError) {
    return error;
  }
  if (error instanceof Error) {
    return new InternalServerError(error.message, { cause: error });
  }
  return new InternalServerError(String(error));
}

export class InternalServerError extends AppError {
  constructor(message: string, options?: AppErrorOptions) {
    super("INTERNAL", 500, message, options);
  }
}

export class RateLimitedError extends AppError {
  constructor(message: string, options?: AppErrorOptions) {
    super("RATE_LIMITED", 429, message, options);
  }
}
