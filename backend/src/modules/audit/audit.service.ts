import { prisma } from '../../config/database.js';
import type { Prisma } from '../../generated/prisma/client.js';
import type {
  AuditAction,
  AuditEntityType,
  AuditLogInput,
  AuditLogRow,
  PaginatedAuditLogs,
} from './audit.types.js';
import {
  sanitizeAuditMetadata,
  AUDIT_FIELDS_WHITELIST,
  AUDIT_MIME_WHITELIST,
} from '../../shared/utils/pii-redaction.js';

/**
 * Kolom kunci yang diizinkan di metadata audit. Semua data di luar daftar ini
 * (password, token, email, file key, nama file asli, URL, NIK, no rekening,
 * alasan bebas, narasi bebas, dll.) DILARANG masuk agar audit_logs tidak
 * kebocoran PII/secret. Nilai string selain dari enum/format aman juga ditolak
 * oleh sanitizeMetadata (lihat pii-redaction.ts).
 */
const ALLOWED_META_KEYS = new Set([
  'fromStatus',
  'toStatus',
  'fromRole',
  'toRole',
  'field',
  'fields',
  'cancelledCount',
  'isPaymentProof',
  'sensitive',
  'sizeBytes',
  'mimeType',
  'evidenceId',
  'transactionId',
  'role',
  'parentId',
  'trigger',
]);

function sanitizeMetadata(
  metadata: Record<string, unknown> | null | undefined
): Record<string, unknown> | null {
  return sanitizeAuditMetadata(metadata, ALLOWED_META_KEYS);
}

/**
 * Tulis entri audit_logs dalam transaksi yang sama (tx). Panggilan ini
 * HANYA dilakukan di dalam $transaction yang sedang berjalan; jangan buka
 * transaksi terpisah di sini, dan jangan menulis setelah commit.
 *
 * @param tx Klien transaksi Prisma yang aktif (tidak boleh PrismaClient global)
 * @param input Data audit
 */
export async function writeAudit(
  tx: Prisma.TransactionClient,
  input: AuditLogInput
): Promise<void> {
  await tx.auditLog.create({
    data: {
      eventId: input.eventId,
      actorId: input.actorId,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      metadata: (sanitizeMetadata(input.metadata) as Prisma.InputJsonValue | null) ?? undefined,
    },
  });
}

export async function listAuditLogs(
  eventId: string,
  {
    page,
    perPage,
    action,
    entityType,
    entityId,
  }: {
    page: number;
    perPage: number;
    action?: AuditAction;
    entityType?: AuditEntityType;
    entityId?: string;
  }
): Promise<PaginatedAuditLogs> {
  const p = Math.max(1, page);
  const pp = Math.min(100, Math.max(1, perPage));
  const skip = (p - 1) * pp;

  const where: Prisma.AuditLogWhereInput = { eventId };
  if (action) where.action = action;
  if (entityType) where.entityType = entityType;
  if (entityId) where.entityId = entityId;

  const [rows, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      select: {
        id: true,
        eventId: true,
        actorId: true,
        action: true,
        entityType: true,
        entityId: true,
        metadata: true,
        createdAt: true,
        actor: { select: { id: true, user: { select: { name: true } } } },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: pp,
    }),
    prisma.auditLog.count({ where }),
  ]);

  const items: AuditLogRow[] = rows.map((r) => ({
    id: r.id,
    eventId: r.eventId,
    actorId: r.actorId,
    action: r.action,
    entityType: r.entityType,
    entityId: r.entityId,
    // Sanitasi-on-read: kunci di luar allowlist dan nilai yang tidak lulus
    // validator (termasuk PII legacy yang mungkin tertulis sebelum sanitasi
    // pada tulisan, atau baris dari environment lain) tidak pernah dikembalikan,
    // apa pun isi DB.
    metadata: sanitizeMetadata(r.metadata as Record<string, unknown> | null),
    createdAt: r.createdAt,
  }));

  return {
    items,
    meta: { page: p, perPage: pp, total, totalPages: Math.ceil(total / pp) },
  };
}

// Diekspor untuk pengujian unit nilai metadata yang aman.
export { sanitizeAuditMetadata, AUDIT_FIELDS_WHITELIST, AUDIT_MIME_WHITELIST };
