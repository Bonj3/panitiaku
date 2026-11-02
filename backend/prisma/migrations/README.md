# backend/prisma/migrations/README.md

Polanya migration SQL manual (Phase 4-5 per PROJECT.md §11.2).
Berkas ini wajib dijaga tetap akurat agar reprodusibel di tiap environment.

Prisma 7 tidak mampu mewakili sepenuhnya constraint berikut dalam `schema.prisma`,
oleh karena itu ditulis sebagai migration SQL mentah (`--create-only` kemudian diedit
secara manual) dan diletakkan di `backend/prisma/migrations/<timestamp>_<nama>/migration.sql`.

## 1. Prasyarat indeks unik untuk composite FK

Composite self-FK membutuhkan kolom target yang unik. **PK pada `id` sendirian
TIDAK cukup** untuk target composite FK di PostgreSQL: DB menyarankan unique
index tepat pada kolom target komposit `(event_id, id)`. Dalam Fase 3 hal ini
terpenuhi oleh `@@unique([eventId, id])` pada model `EventMember` di
`schema.prisma`, yang menghasilkan unique index
`event_members_event_id_id_key` — yang kemudian menjadi target FK komposit
`(event_id, parent_id) → event_members(event_id, id)`.

```sql
-- Dijalankan sebagai bagian dari migration yang membuat tabel event_members.
-- Unique index pada (event_id, id) WAJIB ada sebelum composite FK ditambahkan
-- (di Fase 3 disediakan oleh @@unique([eventId, id]) di schema.prisma).
```

## 2. Composite self-FK: parent harus ada dalam event yang sama

Project §11.1 aturan 8: parent dan child harus dalam event yang sama, ditegakkan via
`(event_id, parent_id) → event_members(event_id, id)` + validasi aplikasi.

```sql
ALTER TABLE event_members
  ADD CONSTRAINT event_members_parent_same_event_fkey
  FOREIGN KEY (event_id, parent_id)
  REFERENCES event_members(event_id, id)
  ON DELETE RESTRICT;
```

Catatan: `parent_id` nullable (root memiliki NULL). FK composite dengan kolom nullable
tidak memaksa parent saat NULL — konsisten dengan aturan "root parent_id IS NULL".

## 3. Partial unique: tepat satu root per event

`UNIQUE(event_id) WHERE parent_id IS NULL` — satu EVENT_CHAIR root per event (BR root).

```sql
CREATE UNIQUE INDEX event_members_one_root_per_event_idx
  ON event_members(event_id)
  WHERE parent_id IS NULL;
```

## 4. Partial unique: satu posting ledger normal per transaksi

`UNIQUE(transaction_id) WHERE reversal_of IS NULL` — idempotensi posting (BR-11).

```sql
CREATE UNIQUE INDEX ledger_entries_one_normal_posting_per_tx_idx
  ON ledger_entries(transaction_id)
  WHERE reversal_of IS NULL;
```

Satu reversal per entri ledger (reversal_of IS NOT NULL) — mencegah entri mendapatkan lebih dari satu reversal.

```sql
CREATE UNIQUE INDEX ledger_entries_one_reversal_per_entry_idx
  ON ledger_entries(reversal_of)
  WHERE reversal_of IS NOT NULL;
```

## 5. Partial unique: satu undangan PENDING per event + email

`UNIQUE(event_id, email) WHERE status = 'PENDING'` — mencegah spam undangan ganda.

```sql
CREATE UNIQUE INDEX invitations_one_pending_per_event_email_idx
  ON invitations(event_id, lower(email))
  WHERE status = 'PENDING';
```

Catatan: `lower(email)` agar case-insensitive konsisten dengan normalisasi aplikasi.

### 5a. Composite same-event FK untuk undangan (Fase 4a)

`parent_id` dan `invited_by` masing-masing sudah punya FK sederhana ke
`event_members(id)` (dari Prisma). Composite FK di bawah memaksa keduanya
berada dalam event yang sama dengan undangan, targetnya unique index
`event_members_event_id_id_key` (Fase 3):

```sql
ALTER TABLE invitations
  ADD CONSTRAINT invitations_parent_same_event_fkey
  FOREIGN KEY (event_id, parent_id)
  REFERENCES event_members(event_id, id)
  ON DELETE RESTRICT;

ALTER TABLE invitations
  ADD CONSTRAINT invitations_inviter_same_event_fkey
  FOREIGN KEY (event_id, invited_by)
  REFERENCES event_members(event_id, id)
  ON DELETE RESTRICT;
```

`role` dibatasi oleh tipe ENUM `InvitationRole` (`DIVISION_LEADER`, `MEMBER`);
`EVENT_CHAIR` tidak dapat disisipkan, tidak perlu CHECK redundan.

### 5b. Composite same-event FK untuk transaksi keuangan (Fase 5)

`submitter_id` dan `approver_id` di `financial_transactions` serta `posted_by_id` di
`ledger_entries` masing-masing sudah punya FK sederhana ke `event_members(id)` (dari
Prisma). Composite FK di bawah memaksa `submitter_id` / `approver_id` berada dalam
event yang sama dengan transaksi, targetnya unique index `event_members_event_id_id_key`
(Fase 3). Disediakan oleh migration **`20261101171718_phase5_finance_transactions_ledger`**:

```sql
ALTER TABLE financial_transactions
  ADD CONSTRAINT financial_transactions_submitter_same_event_fkey
  FOREIGN KEY (event_id, submitter_id)
  REFERENCES event_members(event_id, id)
  ON DELETE RESTRICT;

ALTER TABLE financial_transactions
  ADD CONSTRAINT financial_transactions_approver_same_event_fkey
  FOREIGN KEY (event_id, approver_id)
  REFERENCES event_members(event_id, id)
  ON DELETE RESTRICT;
```

Catatan: kolom `changed_by` (`transaction_history`) dan `posted_by` (`ledger_entries`)
memakai FK sederhana ke `event_members(id)` yang konsistensi event-nya dijaga oleh
aplikasi — tabel history/ledger tidak punya kolom `event_id` sendiri, jadi composite
same-event FK tidak diterapkan padanya.

## 6. Trigger anti-mutasi ledger_entries (BR-10)

Disediakan oleh migration **`20261101171718_phase5_finance_transactions_ledger`**. Ledger tidak boleh diedit/dihapus. Pertahanan kedua di DB via trigger
`BEFORE UPDATE OR DELETE → RAISE EXCEPTION`, dengan escape hatch `app.allow_ledger_delete='on'` (hanya `SET LOCAL` dalam transaksi, untuk maintenance/retensi/cleanup test; aplikasi tidak pernah menyetelnya). Guard utama tetap di aplikasi.

```sql
-- Dijalankan sebagai bagian dari migration 20261101171718_phase5_finance_transactions_ledger.
CREATE OR REPLACE FUNCTION ledger_entries_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE'
     AND coalesce(current_setting('app.allow_ledger_delete', true), '') = 'on' THEN
    -- Escape hatch: hanya DELETE yang diizinkan, dan hanya dalam transaksi yang
    -- menyetel app.allow_ledger_delete='on' dengan SET LOCAL.
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'ledger_entries immutable: % tidak diizinkan', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ledger_entries_immutable
  BEFORE UPDATE OR DELETE ON ledger_entries
  FOR EACH ROW
  EXECUTE FUNCTION ledger_entries_guard();
```

Catatan implementasi:
- Fungsi harus bernilai `RETURNS trigger` (bukan `event_trigger`) karena dipakai oleh trigger per-baris (`FOR EACH ROW`).
- Untuk `DELETE` dengan escape hatch, kembalikan `OLD` agar baris tetap dihapus; untuk semua kasus lain (UPDATE, atau DELETE tanpa escape hatch) function me-raise exception sehingga operasi dibatalkan.
- Trigger bernama `ledger_entries_immutable` pada tabel `ledger_entries`.

## 7. CHECK constraint tambahan (dianjurkan migration SQL)

```sql
-- Uang: amount > 0, tanpa float (NUMERIC(19,2))
ALTER TABLE financial_transactions
  ADD CONSTRAINT financial_transactions_amount_positive CHECK (amount > 0);

ALTER TABLE ledger_entries
  ADD CONSTRAINT ledger_entries_amount_positive CHECK (amount > 0);

-- REJECTED wajib disertai alasan penolakan.
ALTER TABLE financial_transactions
  ADD CONSTRAINT financial_transactions_rejected_reason CHECK (
    status <> 'REJECTED' OR reject_reason IS NOT NULL
  );

-- Entri ledger tidak boleh mereversal dirinya sendiri.
ALTER TABLE ledger_entries
  ADD CONSTRAINT ledger_entries_reversal_not_self CHECK (
    reversal_of IS NULL OR reversal_of <> id
  );

-- Anti self-parent (BR-07)
ALTER TABLE event_members
  ADD CONSTRAINT event_members_no_self_parent CHECK (id <> parent_id);

-- Chair selalu root, non-Chair bukan root (pendamping lapis aplikasi)
ALTER TABLE event_members
  ADD CONSTRAINT event_members_chair_is_root CHECK (
    (role = 'EVENT_CHAIR' AND parent_id IS NULL)
    OR (role <> 'EVENT_CHAIR' AND parent_id IS NOT NULL)
  );
```

## 8. Index minimum (PROJECT.md §11 / rules keras)

```sql
CREATE INDEX event_members_event_parent_idx ON event_members(event_id, parent_id);
CREATE INDEX event_members_event_status_idx ON event_members(event_id, status);
CREATE INDEX event_members_event_created_at_desc_idx ON event_members(event_id, created_at DESC);
CREATE INDEX financial_transactions_event_created_at_desc_idx ON financial_transactions(event_id, created_at DESC);
CREATE INDEX ledger_entries_event_posted_at_idx ON ledger_entries(event_id, posted_at);
```

## 8a. Phase 6 — Tabel `transaction_evidence` dan `audit_logs`

Disediakan oleh migration **`20261102170000_phase6_evidence_audit`** (PROJECT.md §16 Phase 6;
§11.1 entitas 6 `transaction_evidence` & entitas 9 `audit_logs`; §5.C evidence management;
BR-12 akses bukti; BR-13 audit log). Model tersedia di `prisma/schema.prisma` dengan
inverse relation pada `FinancialTransaction.evidence`, `EventMember.evidenceUploads`,
`Event.auditLogs`, dan `EventMember.auditLogs`.

```sql
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

CREATE UNIQUE INDEX "transaction_evidence_file_key_key" ON "transaction_evidence"("file_key");
CREATE INDEX "transaction_evidence_transaction_id_idx" ON "transaction_evidence"("transaction_id");
CREATE INDEX "audit_logs_event_id_created_at_idx" ON "audit_logs"("event_id", "created_at" DESC);
CREATE INDEX "audit_logs_entity_type_entity_id_idx" ON "audit_logs"("entity_type", "entity_id");

ALTER TABLE "transaction_evidence" ADD CONSTRAINT "transaction_evidence_transaction_id_fkey"
  FOREIGN KEY ("transaction_id") REFERENCES "financial_transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "transaction_evidence" ADD CONSTRAINT "transaction_evidence_uploaded_by_id_fkey"
  FOREIGN KEY ("uploaded_by_id") REFERENCES "event_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_event_id_fkey"
  FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_id_fkey"
  FOREIGN KEY ("actor_id") REFERENCES "event_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "transaction_evidence"
  ADD CONSTRAINT "transaction_evidence_size_bytes_range" CHECK ("size_bytes" BETWEEN 1 AND 10485760);
```

FK semantik:
- `transaction_evidence.transaction_id → financial_transactions(id)` **ON DELETE CASCADE** — bukti hilang bersama transaksinya.
- `transaction_evidence.uploaded_by_id → event_members(id)` **ON DELETE RESTRICT** — anggota yang meng-upload tidak dapat dihapus sambil bukti masih merujuk kepadanya.
- `audit_logs.event_id → events(id)` **ON DELETE CASCADE** (nullable) — log event diangkat bersama event.
- `audit_logs.actor_id → event_members(id)` **ON DELETE RESTRICT** — pelaku adalah membership id, tidak ada polymorphic actor dari `users` pada MVP (seluruh aksi BR-13 berfungsi dalam konteks event; non-event ditangani future).

Alasan desain:
- `transaction_evidence` sengaja **tidak punya `event_id`**: event ownership diverifikasi layanan keuangan melalui relasi `transaction → event`, bukan denormalisasi di tabel evidence.
- Metadata bersifat immutable pada MVP (tanpa `updated_at`, tanpa endpoint UPDATE/DELETE evidence); "hapus" bukti = soft-flag/penghapusan fisik berkas di luar cakupan tabel ini dan ditangani layanan storage (`StorageProvider`, OD-11, bukan bagian migration ini).
- `CHECK ("size_bytes" BETWEEN 1 AND 10485760)` — batas 10 MB per OD-7.

### Phase 6 — catatan trigger & retensi (BR-10/BR-13)

Tabel **tidak** diberi trigger `BEFORE UPDATE OR DELETE` di Phase 6, dengan alasan berikut:

1. `transaction_evidence`: tidak ada endpoint UPDATE/DELETE pada MVP; append-only ditegakkan lapis aplikasi. Tidak perlu trigger tambahan (PROJECT tidak menuntut).
2. `audit_logs`: retensi "tidak dihapus" (PROJECT §11.1 entitas 9) ditegakkan lapis aplikasi — setiap endpoint tulis penting wajib menulis log, tidak ada endpoint mengubah/menghapus log. **Trigger DB tidak dipasang** karena uji membersihkan data lewat `event.deleteMany()` yang cascades ke `audit_logs` (ON DELETE CASCADE); trigger immutable akan membatalkan cleanup tersebut dan memaksa escape-hatch khusus per uji, yang melanggar aturan tugas "jangan mempersulit test cleanup / jangan ubah test files".

Bila di kemudian hari diputuskan memasang trigger immutable pada `audit_logs`, polanya sama dengan `ledger_entries_guard` (fase 5): escape hatch `SET LOCAL app.allow_audit_delete='on'` dalam transaksi maintenance, dan mekanisme cleanup uji wajib menyetel escape hatch tersebut sebelum `deleteMany` pada event/anggota.

## 9. Catatan migrasi Prisma 7

- Gunakan `prisma migrate dev --create-only <nama>` untuk menghasilkan skeleton,
  lalu sisipkan DDL manual di atas ke dalam berkas `migration.sql`.
- Jangan biarkan Prisma Migrate overwrite/mengubah DDL manual yang sudah tercommit.
- `prisma migrate deploy` hanya menjalankan berkas migration — custom DDL di atas
  akan diterapkan secara otomatis saat deploy.

## 10. Backfill metadata `audit_logs` legacy PII (non-destructif)

Migration **`20261102200000_audit_metadata_legacy_pii_redact`** membersihkan
baris lama di `audit_logs` yang mungkin ditulis sebelum sanitasi-on-write /
sanitasi-on-read diberlaku, dan berisiko meluarkan PII melalui
`GET /api/v1/events/:eventId/audit-logs` (re-review finding `listAuditLogs`):

- Baris `audit_logs` **tidak pernah dihapus** (retensi BR-13 tetap terpenuhi).
- `metadata` di-set `NULL` bila berisi kunci di luar allowlist aplikasi
  (`ALLOWED_META_KEYS` di `audit_service.ts`) atau pola PII mentah
  (email, telepon, nomor rekening 8-20 digit, URL dengan query token).
- Idempotent: aman dijalankan berulang kali; baris yang sudah bersih tidak
  tersentuh.
- Ini adalah lapis tambahan (defense in depth), bukan pengganti sanitasi
  pada tulisan (`writeAudit`) dan pada baca (`listAuditLogs`).

Inspeksi environment dev/test saat ini: `audit_logs` kosong (0 baris), sehingga
tidak ada legacy PII terdeteksi; migration diwakili sebagai no-op di keduanya.

### 10a. Follow-up: bentuk `jsonb_object_keys` aman terpisah

Follow-up **`20261102220000_audit_metadata_jsonb_object_keys_safe`** mengulang
logika sanitasi 20261102210000 (yang sudah diterapkan dan TIDAK BOLEH DIEDIT)
dengan argumen `jsonb_object_keys` yang aman terpisah:

```sql
jsonb_object_keys(CASE WHEN jsonb_typeof(metadata)='object'
                       THEN metadata ELSE '{}'::jsonb END)
```

Hal ini menghilangkan ketergantungan pada short-circuit evaluasi `AND` untuk
mencegah pemanggilan `jsonb_object_keys` pada non-objek (array/skalar/null),
sebagai temuan reviewer. Migrasi ini idempotent dan no-op pada data yang sudah
bersih.

## 11. Batasan yang dikelola di aplikasi (bukan DB)

- Deteksi cycle saat pindah parent: validasi subtree dalam DB transaction
  (query CTE #4 PROJECT.md §5.A), bukan murni FK.
- Satukan pembuatan membership + undangan dalam satu transaksi (invitasi #8).
- Ledger posting atomik dengan `SELECT ... FOR UPDATE` pada transaksi (double posting).
