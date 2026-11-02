-- CreateEnum
CREATE TYPE "InvitationRole" AS ENUM ('DIVISION_LEADER', 'MEMBER');

-- CreateEnum
CREATE TYPE "InvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED');

-- CreateTable
CREATE TABLE "invitations" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "role" "InvitationRole" NOT NULL,
    "parent_id" UUID,
    "token_hash" CHAR(64) NOT NULL,
    "status" "InvitationStatus" NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "invited_by" UUID NOT NULL,
    "accepted_by" UUID,
    "acceptedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invitations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "invitations_token_hash_key" ON "invitations"("token_hash");

-- CreateIndex
CREATE INDEX "invitations_event_id_email_status_idx" ON "invitations"("event_id", "email", "status");

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "event_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_invited_by_fkey" FOREIGN KEY ("invited_by") REFERENCES "event_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_accepted_by_fkey" FOREIGN KEY ("accepted_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Tambahan manual (PROJECT §11.1 no.4 / aturan keras DB Architect):
-- Catatan: parent_id dan invited_by masing-masing sudah punya FK sederhana
-- (dari Prisma di atas) ke event_members(id). Di bawah ditambah composite FK
-- yang memaksa parent / inviter berada dalam event yang sama dengan undangan.
-- Keduanya boleh berdampingan; composite FK adalah yang ditegakkan aturan.

-- Partial unique: satu undangan PENDING per (event, email), case-insensitive.
CREATE UNIQUE INDEX "invitations_one_pending_per_event_email_idx"
  ON "invitations"("event_id", lower("email"))
  WHERE "status" = 'PENDING';

-- Composite FK: parent harus anggota dalam event yang sama.
-- Target (event_id, id) sudah dijamin unik oleh unique index
-- event_members_event_id_id_key (Fase 3).
ALTER TABLE "invitations"
  ADD CONSTRAINT "invitations_parent_same_event_fkey"
  FOREIGN KEY ("event_id", "parent_id")
  REFERENCES "event_members"("event_id", "id")
  ON DELETE RESTRICT;

-- Composite FK: pemberi undangan (invited_by) harus anggota dalam event yang sama.
ALTER TABLE "invitations"
  ADD CONSTRAINT "invitations_inviter_same_event_fkey"
  FOREIGN KEY ("event_id", "invited_by")
  REFERENCES "event_members"("event_id", "id")
  ON DELETE RESTRICT;

-- Index untuk lazy-expire / kueri status per event.
CREATE INDEX "invitations_event_id_status_idx" ON "invitations"("event_id", "status");
CREATE INDEX "invitations_event_id_expires_at_idx" ON "invitations"("event_id", "expiresAt");

-- Catatan: role InvitationRole (DIVISION_LEADER / MEMBER) already enforced by
-- PostgreSQL ENUM type; EVENT_CHAIR tidak dapat disisipkan. Tidak perlu CHECK
-- redundan (dan jangan tambah CHECK yang mustahil / selalu salah).
