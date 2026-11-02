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

export interface ApiError {
  code: ErrorCode;
  message: string;
  details?: Record<string, unknown>;
}

export interface EnvelopeSuccess<T = unknown> {
  success: true;
  data: T;
  meta?: PaginationMeta;
}

export interface EnvelopeError {
  success: false;
  error: ApiError;
}

export type Envelope<T = unknown> = EnvelopeSuccess<T> | EnvelopeError;

export interface PaginationMeta {
  page: number;
  perPage: number;
  total: number;
  totalPages: number;
}

export interface AuthenticatedUser {
  id: string;
  email: string;
  name: string;
}

export interface EventSummary {
  id: string;
  name: string;
  slug: string;
  status: "OPEN" | "CLOSED";
}

export interface EventMembership {
  id: string;
  eventId: string;
  userId: string;
  role: "EVENT_CHAIR" | "DIVISION_LEADER" | "MEMBER";
  status: "ACTIVE" | "INACTIVE";
  event: EventSummary;
}

declare module "express-serve-static-core" {
  interface Request {
    user?: AuthenticatedUser;
    membership?: EventMembership;
    event?: EventSummary;
    sessionToken?: string;
    requestId?: string;
  }
}

export {};
