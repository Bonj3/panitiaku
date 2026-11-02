-- CreateEnum
CREATE TYPE "EventStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "MemberRole" AS ENUM ('EVENT_CHAIR', 'DIVISION_LEADER', 'MEMBER');

-- CreateEnum
CREATE TYPE "MemberStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateTable
CREATE TABLE "events" (
    "id" UUID NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "slug" VARCHAR(180) NOT NULL,
    "description" TEXT,
    "status" "EventStatus" NOT NULL DEFAULT 'OPEN',
    "created_by" UUID NOT NULL,
    "closed_at" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_members" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "MemberRole" NOT NULL,
    "parent_id" UUID,
    "title" VARCHAR(100),
    "status" "MemberStatus" NOT NULL DEFAULT 'ACTIVE',
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "event_members_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "events_slug_key" ON "events"("slug");

-- CreateIndex
CREATE INDEX "events_status_idx" ON "events"("status");

-- CreateIndex
CREATE INDEX "event_members_event_id_parent_id_idx" ON "event_members"("event_id", "parent_id");

-- CreateIndex
CREATE INDEX "event_members_event_id_status_idx" ON "event_members"("event_id", "status");

-- CreateIndex
CREATE INDEX "event_members_event_id_role_idx" ON "event_members"("event_id", "role");

-- CreateIndex
CREATE UNIQUE INDEX "event_members_user_id_event_id_key" ON "event_members"("user_id", "event_id");

-- CreateIndex
CREATE UNIQUE INDEX "event_members_event_id_id_key" ON "event_members"("event_id", "id");

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_members" ADD CONSTRAINT "event_members_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_members" ADD CONSTRAINT "event_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_members" ADD CONSTRAINT "event_members_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "event_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Tambahan manual (PROJECT §11.1 / aturan keras DB Architect):
-- Catatan: kolom parent_id sekarang memiliki DUA FK:
--   1) event_members_parent_id_fkey        -> event_members(id)           (sederhana, dari Prisma)
--   2) event_members_parent_same_event_fkey -> event_members(event_id, id) (komposit, memaksa parent berada dalam event yang sama)
-- Keduanya boleh berdampingan; composite FK adalah yang ditegakkan aturan "parent dalam event sama".

-- Composite self-FK: parent harus ada dalam event yang sama. Target (event_id, id)
-- sudah dijamin unik oleh unique index "event_members_event_id_id_key" di atas
-- (PK pada id alone TIDAK cukup untuk target composite FK di PostgreSQL).
ALTER TABLE "event_members"
  ADD CONSTRAINT "event_members_parent_same_event_fkey"
  FOREIGN KEY ("event_id", "parent_id")
  REFERENCES "event_members"("event_id", "id")
  ON DELETE RESTRICT;

-- Partial unique: tepat satu root (parent_id IS NULL) per event.
CREATE UNIQUE INDEX "event_members_one_root_per_event_idx"
  ON "event_members"("event_id")
  WHERE "parent_id" IS NULL;

-- CHECK: mencegah member menjadi parent dirinya sendiri.
ALTER TABLE "event_members"
  ADD CONSTRAINT "event_members_no_self_parent" CHECK ("id" <> "parent_id");

-- CHECK: EVENT_CHAIR selalu root (parent_id NULL), non-EVENT_CHAIR bukan root.
ALTER TABLE "event_members"
  ADD CONSTRAINT "event_members_chair_is_root" CHECK (
    ("role" = 'EVENT_CHAIR' AND "parent_id" IS NULL)
    OR ("role" <> 'EVENT_CHAIR' AND "parent_id" IS NOT NULL)
  );
