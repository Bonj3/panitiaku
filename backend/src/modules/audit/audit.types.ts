export type AuditAction =
  | "event.create"
  | "event.update"
  | "event.close"
  | "member.move"
  | "member.role.update"
  | "member.status.update"
  | "invitation.create"
  | "invitation.revoke"
  | "invitation.accept"
  | "invitation.expire"
  | "transaction.create"
  | "transaction.update"
  | "transaction.submit"
  | "transaction.approve"
  | "transaction.reject"
  | "transaction.reopen"
  | "transaction.cancel"
  | "transaction.pay"
  | "transaction.reverse"
  | "transaction.cancel_on_event_close"
  | "evidence.upload"
  | "evidence.access"
  | "evidence.sensitive.update";

export type AuditEntityType =
  | "event"
  | "member"
  | "invitation"
  | "transaction"
  | "evidence"
  | "ledger_entry";

export interface AuditLogInput {
  eventId: string;
  actorId: string;
  action: AuditAction;
  entityType: AuditEntityType;
  entityId: string;
  metadata?: Record<string, unknown>;
}

export interface AuditLogRow {
  id: string;
  eventId: string | null;
  actorId: string;
  action: string;
  entityType: string;
  entityId: string;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
}

export interface PaginatedAuditLogs {
  items: AuditLogRow[];
  meta: { page: number; perPage: number; total: number; totalPages: number };
}
