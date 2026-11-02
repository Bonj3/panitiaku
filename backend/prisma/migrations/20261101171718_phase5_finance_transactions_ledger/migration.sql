-- CreateEnum
CREATE TYPE "TransactionType" AS ENUM ('INCOME', 'EXPENSE');

-- CreateEnum
CREATE TYPE "TransactionStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'PAID', 'CANCELLED');

-- CreateEnum
CREATE TYPE "LedgerDirection" AS ENUM ('CREDIT', 'DEBIT');

-- CreateTable
CREATE TABLE "financial_transactions" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "type" "TransactionType" NOT NULL,
    "category" VARCHAR(50) NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(19,2) NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'IDR',
    "status" "TransactionStatus" NOT NULL DEFAULT 'DRAFT',
    "submitter_id" UUID NOT NULL,
    "approver_id" UUID,
    "submitted_at" TIMESTAMP(3),
    "approved_at" TIMESTAMP(3),
    "paid_at" TIMESTAMP(3),
    "reject_reason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "financial_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transaction_history" (
    "id" UUID NOT NULL,
    "transaction_id" UUID NOT NULL,
    "fromStatus" "TransactionStatus",
    "toStatus" "TransactionStatus" NOT NULL,
    "changed_by_id" UUID NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transaction_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_entries" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "transaction_id" UUID NOT NULL,
    "direction" "LedgerDirection" NOT NULL,
    "amount" DECIMAL(19,2) NOT NULL,
    "posted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "posted_by_id" UUID NOT NULL,
    "reversal_of" UUID,
    "narration" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "financial_transactions_event_id_status_idx" ON "financial_transactions"("event_id", "status");

-- CreateIndex
CREATE INDEX "financial_transactions_event_id_type_idx" ON "financial_transactions"("event_id", "type");

-- CreateIndex
CREATE INDEX "financial_transactions_event_id_created_at_idx" ON "financial_transactions"("event_id", "createdAt");

-- CreateIndex
CREATE INDEX "financial_transactions_submitter_id_idx" ON "financial_transactions"("submitter_id");

-- CreateIndex
CREATE INDEX "transaction_history_transaction_id_created_at_idx" ON "transaction_history"("transaction_id", "createdAt");

-- CreateIndex
CREATE INDEX "ledger_entries_event_id_posted_at_idx" ON "ledger_entries"("event_id", "posted_at");

-- CreateIndex
CREATE INDEX "ledger_entries_event_id_direction_idx" ON "ledger_entries"("event_id", "direction");

-- AddForeignKey
ALTER TABLE "financial_transactions" ADD CONSTRAINT "financial_transactions_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_transactions" ADD CONSTRAINT "financial_transactions_submitter_id_fkey" FOREIGN KEY ("submitter_id") REFERENCES "event_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_transactions" ADD CONSTRAINT "financial_transactions_approver_id_fkey" FOREIGN KEY ("approver_id") REFERENCES "event_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction_history" ADD CONSTRAINT "transaction_history_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "financial_transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction_history" ADD CONSTRAINT "transaction_history_changed_by_id_fkey" FOREIGN KEY ("changed_by_id") REFERENCES "event_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "financial_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_posted_by_id_fkey" FOREIGN KEY ("posted_by_id") REFERENCES "event_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_reversal_of_fkey" FOREIGN KEY ("reversal_of") REFERENCES "ledger_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Tambahan manual (PROJECT §11.1 entitas 5-8 / aturan keras DB Architect):
-- Simple FK di atas (submitter_id, approver_id, posted_by_id, reversal_of) ditahan.
-- Di bawah ditambah composite same-event FK yang memaksa referensi EventMember
-- berada dalam event yang sama dengan transaksi/entri ledger. Target
-- (event_id, id) sudah dijamin unik oleh unique index
-- event_members_event_id_id_key (Fase 3).

-- CHECK: uang selalu positif, tanpa float (DECIMAL(19,2))
ALTER TABLE "financial_transactions"
  ADD CONSTRAINT "financial_transactions_amount_positive" CHECK ("amount" > 0);

ALTER TABLE "ledger_entries"
  ADD CONSTRAINT "ledger_entries_amount_positive" CHECK ("amount" > 0);

-- CHECK: REJECTED wajib disertai alasan penolakan.
ALTER TABLE "financial_transactions"
  ADD CONSTRAINT "financial_transactions_rejected_reason" CHECK (
    "status" <> 'REJECTED' OR "reject_reason" IS NOT NULL
  );

-- Composite same-event FK: submitter adalah anggota event yang sama.
ALTER TABLE "financial_transactions"
  ADD CONSTRAINT "financial_transactions_submitter_same_event_fkey"
  FOREIGN KEY ("event_id", "submitter_id")
  REFERENCES "event_members"("event_id", "id")
  ON DELETE RESTRICT;

-- Composite same-event FK: approver adalah anggota event yang sama (jika diisi).
ALTER TABLE "financial_transactions"
  ADD CONSTRAINT "financial_transactions_approver_same_event_fkey"
  FOREIGN KEY ("event_id", "approver_id")
  REFERENCES "event_members"("event_id", "id")
  ON DELETE RESTRICT;

-- Partial unique: satu posting ledger normal per transaksi (reversal_of IS NULL).
CREATE UNIQUE INDEX "ledger_entries_one_normal_posting_per_tx_idx"
  ON "ledger_entries"("transaction_id")
  WHERE "reversal_of" IS NULL;

-- Partial unique: satu reversal per entri ledger (reversal_of IS NOT NULL).
CREATE UNIQUE INDEX "ledger_entries_one_reversal_per_entry_idx"
  ON "ledger_entries"("reversal_of")
  WHERE "reversal_of" IS NOT NULL;

-- CHECK: entri tidak boleh mereversal dirinya sendiri.
ALTER TABLE "ledger_entries"
  ADD CONSTRAINT "ledger_entries_reversal_not_self" CHECK (
    "reversal_of" IS NULL OR "reversal_of" <> "id"
  );

-- Index tambahan untuk kueri finance.
CREATE INDEX "financial_transactions_event_id_created_at_desc_idx"
  ON "financial_transactions"("event_id", "createdAt" DESC);

-- Trigger immutable pada ledger_entries (BR-10).
-- Escape hatch app.allow_ledger_delete='on' (SET LOCAL dalam transaksi) hanya
-- untuk maintenance/retensi & cleanup test; aplikasi tidak pernah menyetelnya.
CREATE OR REPLACE FUNCTION ledger_entries_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE'
     AND coalesce(current_setting('app.allow_ledger_delete', true), '') = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'ledger_entries immutable: % tidak diizinkan', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ledger_entries_immutable
  BEFORE UPDATE OR DELETE ON ledger_entries
  FOR EACH ROW
  EXECUTE FUNCTION ledger_entries_guard();
