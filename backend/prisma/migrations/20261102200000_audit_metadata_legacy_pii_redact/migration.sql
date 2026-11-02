-- Phase 6b — Backfill non-destructif: membersanitasi metadata `audit_logs` lama
-- yang mungkin mengandung PII (email, nomor telepon, nomor rekening 8-20 digit,
-- URL dengan query token, alasan/narasi bebas, nama berkas, dll.) atau kunci
-- di luar allowlist aplikasi (`ALLOWED_META_KEYS` di audit.service.ts).
--
-- Tidak menghapus baris audit_logs (retensi BR-13 tetap terpenuhi). Metadata
-- yang terdeteksi berisiko di-set NULL. Baris yang sudah bersih tidak tersentuh.
-- Idempotent: aman dijalankan berulang kali (setelah dijalankan, kondisi WHERE
-- tidak lagi terpenuhi untuk baris yang sudah NULL).
--
-- Pemicu: re-review finding `listAuditLogs` mengembalikan metadata tersimpan
-- secara langsung. Sanitasi-on-read sudah diterapkan di audit.service.ts;
-- migration ini membersihkan data legacy yang mungkin sudah ada di environment
-- lama sebagai lapis pertambahan (defense in depth), bukan pengganti sanitasi
-- pada baca/tulis.
UPDATE "audit_logs"
SET "metadata" = NULL
WHERE "metadata" IS NOT NULL
  AND (
    -- Ada kunci di luar daftar kunci yang diizinkan aplikasi.
    EXISTS (
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
    -- Nilai menyisipkan pola PII mentah (deteksi seband dengan validator
    -- pii-redaction.ts: email, telepon, nomor rekening/ID panjang, URL token).
    OR "metadata"::text ~* '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}'
    OR "metadata"::text ~ '(?<!\d)(?:\+?62|0)?\s*[\d\s().-]{7,15}(?!\d)'
    OR "metadata"::text ~ '(?<!\d)\d{8,20}(?!\d)'
    OR "metadata"::text ~* 'https?://[^\s]+[?&](?:token|access_token|api_key|secret|key)=[^\s]+'
  );
