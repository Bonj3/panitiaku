-- Phase 6 — Evidence & Audit (PROJECT.md §16 Phase 6, §11.1 entitas 6 & 9, §13.6, §5.C, BR-12/BR-13)
--
-- Tabel baru:
--   transaction_evidence  — metadata bukti transaksi (append-only, tidak ada endpoint UPDATE/DELETE pada MVP)
--   audit_logs            — jejak aktivitas lintas-domain (append-only, ditulis aplikasi; BR-13)
--
-- Tidak ada trigger tambahan pada kedua tabel ini (lihat catatan di bagian bawah dan
-- backend/prisma/migrations/README.md bagian "Phase 6 — catatan trigger & retensi").
-- Prisma 7: model ada di prisma/schema.prisma; migration ini menyediakan DDL eksplisit
-- (CHECK constraint berukuran berkas, FK semantik, unique file_key, indeks).

-- CreateTable
CREATE TABLE "transaction_evidence" (
    "id" UUID NOT NULL,
    "transaction_id" UUID NOT NULL,
    "file_key" TEXT NOT NULL,
    "original_name" VARCHAR(255) NOT NULL,
    "mime_type" VARCHAR(100) NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "is_payment_proof" BOOLEAN NOT NULL DEFAULT false,
    "sensitive" BOOLEAN NOT NULL DEFAULT false,
    "uploaded_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transaction_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "event_id" UUID,
    "actor_id" UUID NOT NULL,
    "action" VARCHAR(100) NOT NULL,
    "entity_type" VARCHAR(50) NOT NULL,
    "entity_id" TEXT NOT NULL,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "transaction_evidence_file_key_key" ON "transaction_evidence"("file_key");

-- CreateIndex
CREATE INDEX "transaction_evidence_transaction_id_idx" ON "transaction_evidence"("transaction_id");

-- CreateIndex
CREATE INDEX "audit_logs_event_id_created_at_idx" ON "audit_logs"("event_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_entity_type_entity_id_idx" ON "audit_logs"("entity_type", "entity_id");

-- AddForeignKey
ALTER TABLE "transaction_evidence" ADD CONSTRAINT "transaction_evidence_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "financial_transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction_evidence" ADD CONSTRAINT "transaction_evidence_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "event_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "event_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Tambahan manual (aturan keras DB Architect / PROJECT.md):
-- CHECK: ukuran berkas bukti antara 1 byte dan 10 MB (OD-7 = 10 MB = 10485760 byte).
ALTER TABLE "transaction_evidence"
  ADD CONSTRAINT "transaction_evidence_size_bytes_range" CHECK ("size_bytes" BETWEEN 1 AND 10485760);

-- Catatan:
-- - transaction_evidence tidak punya kolom event_id; kepemilikan event diverifikasi di
--   layanan keuangan melalui relasi transaction → event (event ownership di service, bukan DB).
-- - audit_logs.actor_id berupa id membership event (event-scoped, BR-13); tidak ada
--   polymorphic actor dari users untuk MVP.
-- - Kedua tabel append-only pada MVP: tidak ada UPDATE/DELETE endpoint, tidak ada trigger
--   DB tambahan (retensi "tidak dihapus" ditegakkan lapis aplikasi; lihat README fase 6).
