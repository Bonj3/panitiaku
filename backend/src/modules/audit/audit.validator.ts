import { z } from "zod";

export const auditLogsQuerySchema = z
  .object({
    page: z
      .string()
      .regex(/^\d+$/, "Page harus angka")
      .transform((s) => Math.max(1, parseInt(s, 10)))
      .default(1),
    perPage: z
      .string()
      .regex(/^\d+$/, "perPage harus angka")
      .transform((s) => Math.min(100, Math.max(1, parseInt(s, 10))))
      .default(20),
    action: z
      .enum([
        "event.create",
        "event.update",
        "event.close",
        "member.move",
        "member.role.update",
        "member.status.update",
        "invitation.create",
        "invitation.revoke",
        "invitation.accept",
        "invitation.expire",
        "transaction.create",
        "transaction.update",
        "transaction.submit",
        "transaction.approve",
        "transaction.reject",
        "transaction.reopen",
        "transaction.cancel",
        "transaction.pay",
        "transaction.reverse",
        "transaction.cancel_on_event_close",
        "evidence.upload",
        "evidence.access",
        "evidence.sensitive.update",
      ])
      .optional(),
    entityType: z
      .enum(["event", "member", "invitation", "transaction", "evidence", "ledger_entry"])
      .optional(),
    entityId: z.string().uuid("ID entitas harus UUID").optional(),
  })
  .strict();

export type AuditLogsQuery = z.infer<typeof auditLogsQuerySchema>;
