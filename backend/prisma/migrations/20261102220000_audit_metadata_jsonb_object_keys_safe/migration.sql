-- Phase 6c (follow-up) — Backfill non-destructif: membersanitasi metadata `audit_logs` lama
-- dengan bentuk `jsonb_object_keys` yang AMAN TERPISAH (independently safe).
--
-- Konteks:
--  - Migrasi perbaikan 20261102210000_audit_metadata_legacy_pii_redact_repair sudah
--    TERCATAT SELESAI di _prisma_migrations (dev dan test) dan OLEH KARENA ITU
--    TIDAK BOLEH DIEDIT (integritas checksum migrasi).
--  - Reviewer menemukan bahwa pemanggilan `jsonb_object_keys("metadata")` di dalam
--    `EXISTS ... AND jsonb_typeof("metadata") = 'object'` bergantung pada short-circuit
--    evaluasi AND agar tidak dievaluasi pada non-objek. Meskipun PostgreSQL
--    short-circuit AND, pedoman reviewer mengharuskan argumen fungsi
--    `jsonb_object_keys` aman sendirian, terlepas dari urutan evaluasi.
--
-- Perbaikan di follow-up ini (tidak mengedit migrasi yang sudah diterapkan):
--  - Argumen jsonb_object_keys dibungkus CASE agar selalu objek:
--      jsonb_object_keys(CASE WHEN jsonb_typeof(metadata)='object'
--                             THEN metadata ELSE '{}'::jsonb END)
--    Ini aman untuk metadata array, skalar (string/number/boolean), dan null
--    tanpa tergantung short-circuit AND.
--  - Tidak menghapus baris audit_logs (retensi BR-13 tetap terpenuhi). Metadata
--    yang terdeteksi berisiko di-set NULL. Baris yang sudah bersih tidak tersentuh.
--  - Idempotent: aman dijalankan berulang kali (setelah dijalankan, kondisi WHERE
--    tidak lagi terpenuhi untuk baris yang sudah NULL).
--
-- Diperbaharui dari logika 20261102210000 (sudah diterapkan) dengan pola yang
-- disetujui reviewer agar riwayat migrasi mencakup bentuk yang aman terpisah.

UPDATE "audit_logs"
SET "metadata" = NULL
WHERE "metadata" IS NOT NULL
  AND (
    -- Ada kunci di luar daftar kunci yang diizinkan aplikasi (hanya objek).
    -- jsonb_object_keys dipanggil pada argumen yang selalu objek (CASE di bawah),
    -- sehingga aman untuk array / skalar / null tanpa mengandalkan short-circuit AND.
    EXISTS (
      SELECT 1
      FROM jsonb_object_keys(
        CASE WHEN jsonb_typeof("metadata") = 'object'
             THEN "metadata" ELSE '{}'::jsonb END
      ) AS k
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
    -- Nilai menyisipkan pola PII mentah (deteksi seband dengan validator
    -- pii-redaction.ts: email, telepon, nomor rekening/ID panjang, URL token).
    -- Semua pola aman untuk PostgreSQL 16 (tanpa lookbehind/lookahead) dan untuk
    -- JSONB object/array/scalar/null (dievaluasi pada representasi teks).
    OR "metadata"::text ~* '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}'
    OR "metadata"::text ~* 'https?://[^\s]+[?&](?:token|access_token|api_key|secret|key)=[^\s]+'
    OR "metadata"::text ~ '\m(?:\+?62|0)?\s*[\d\s().-]{7,15}\M'
    OR "metadata"::text ~ '\m\d{8,20}\M'
  );
