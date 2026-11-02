-- Phase 6b (perbaikan) — Backfill non-destructif: membersanitasi metadata `audit_logs` lama
-- yang mungkin mengandung PII (email, nomor telepon, nomor rekening 8-20 digit,
-- URL dengan query token, alasan/narasi bebas, nama berkas, dll.) atau kunci
-- di luar allowlist aplikasi (`ALLOWED_META_KEYS` di audit.service.ts).
--
-- Perbaikan terhadap migrasi 20261102200000_audit_metadata_legacy_pii_redact
-- yang sudah TERCATAT SELESAI di _prisma_migrations (dev dan test) dan OLEH
-- KARENA ITU TIDAK BOLEH DIEDIT (integritas checksum migrasi):
--  - Pola PII ditulis TANPA lookbehind/lookahead regex `(?<!\d)` / `(?!\d)` yang
--    tidak andal pada PostgreSQL 16, menggunakan batas kata \m ... \M sebagai
--    pengganti yang ekuivalen untuk deteksi deret digit.
--  - jsonb_object_keys hanya dipanggil bila metadata bertipe objek
--    (jsonb_typeof = 'object'), sehingga aman untuk metadata array, skalar, dan
--    null (jsonb_object_keys error pada non-objek).
--  - Tidak menghapus baris audit_logs (retensi BR-13 tetap terpenuhi). Metadata
--    yang terdeteksi berisiko di-set NULL. Baris yang sudah bersih tidak tersentuh.
--  - Idempotent: aman dijalankan berulang kali (setelah dijalankan, kondisi WHERE
--    tidak lagi terpenuhi untuk baris yang sudah NULL).
--
-- Berkas asli 20261102200000/migration.sql tetap utuh. Perbaikan disampaikan
-- sebagai migrasi ikutan agar _prisma_migrations tetap konsisten di kedua DB.

UPDATE "audit_logs"
SET "metadata" = NULL
WHERE "metadata" IS NOT NULL
  AND (
    -- Ada kunci di luar daftar kunci yang diizinkan aplikasi (hanya objek).
    (
      jsonb_typeof("metadata") = 'object'
      AND EXISTS (
        SELECT 1
        FROM jsonb_object_keys("metadata") AS k
        WHERE k NOT IN (
          'fromStatus', 'toStatus',
          'fromRole', 'toRole',
          'field', 'fields',
          'cancelledCount',
          'isPaymentProof',
          'sensitive',
          'sizeBytes',
          'mimeType',
          'evidenceId',
          'transactionId',
          'role',
          'parentId',
          'trigger'
        )
      )
    )
    -- Nilai menyisipkan pola PII mentah (deteksi seband dengan validator
    -- pii-redaction.ts: email, telepon, nomor rekening/ID panjang, URL token).
    -- Semua pola aman untuk PostgreSQL 16 (tanpa lookbehind/lookahead) dan untuk
    -- JSONB object/array/scalar/null (dievaluasi pada representasi teks).
    OR "metadata"::text ~* '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}'
    OR "metadata"::text ~* 'https?://[^\s]+[?&](?:token|access_token|api_key|secret|key)=[^\s]+'
    OR "metadata"::text ~ '\m(?:\+?62|0)?\s*[\d\s().-]{7,15}\M'
    OR "metadata"::text ~ '\m\d{8,20}\M'
  );
