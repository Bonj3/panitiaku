-- Phase 6b — Rename createdAt → created_at in evidence & audit tables
--
-- Migration 20261102170000_phase6_evidence_audit created columns named
-- "createdAt" (camelCase) but Prisma models expect "created_at" (snake_case
-- via @map). This migration renames them to match the Prisma schema.
--
-- Applied to databases that already received 20261102170000_phase6_evidence_audit.

-- Rename column in transaction_evidence
ALTER TABLE "transaction_evidence"
  RENAME COLUMN "createdAt" TO "created_at";

-- Rename column in audit_logs
ALTER TABLE "audit_logs"
  RENAME COLUMN "createdAt" TO "created_at";

-- Recreate index on audit_logs with correct column name (index definition
-- references the column, PostgreSQL handles this automatically on rename,
-- but we ensure the index name still matches).
DROP INDEX IF EXISTS "audit_logs_event_id_created_at_idx";
CREATE INDEX "audit_logs_event_id_created_at_idx" ON "audit_logs"("event_id", "created_at" DESC);
