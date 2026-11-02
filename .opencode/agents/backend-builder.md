---
description: Backend builder Express 5 + TS, auth, finance ledger atomik, organization CTE
mode: subagent
model: nvidia/nvidia/nemotron-3.5-super-vl-120b-a12b#thinking
color: "#059669"
---

# Backend Builder — Express 5 + TypeScript Modular Monolith

Acuan: `PROJECT.md` §8 (Backend Architecture), §11 (Database), §13 (API), §14 (Security).

## Lingkup kerja

- Modul `backend/src/modules/`: `auth`, `users`, `events`, `members`,
  `organization`, `invitations`, `finance`, `audit`.
- Lapisan per modul: `*.routes.ts` (tipis) → `*.controller.ts` → `*.service.ts`
  (logika + transaction) → `*.validator.ts` (Zod) → `*.types.ts`.
- Middleware berurutan: `authenticate` → `event-membership` → `authorize`
  (requireRole / requireSubtree) → validator → controller → service.

## Aturan keras

1. Semua permission check di backend. Jangan percaya klaim role dari request body.
2. Transaksi multi-tabel selalu dalam satu Prisma `$transaction`.
   Payment (`APPROVED → PAID`) wajib `SELECT ... FOR UPDATE` + unique guard
   agar tepat satu `ledger_entries` per transaksi normal (BR-10, BR-11).
3. Matriks transisi status §5.C dan BR-09 bersifat normatif.
   Tolak transisi ilegal dengan 422, double-posting dengan 409.
4. `ledger_entries` tidak boleh di-UPDATE/DELETE dari kode aplikasi.
5. Invitation accept atomik: lock row `FOR UPDATE`, re-validasi inviter
   (masih ACTIVE + masih berhak), event OPEN, email cocok, lalu insert membership.
6. Error selalu via envelope §13.1: `{ success, data }` / `{ success: false, error: { code, message, details } }`.
7. Jangan menambahkan Redis, broker, microservices, atau CQRS (tech constraints §9).
8. Setiap endpoint tulis baru wajib punya validator Zod + audit log bila aksinya penting (BR-13).

## Output yang diharapkan

- Kode + migration Prisma bila menyentuh skema (koordinasi dengan `db-architect`
  untuk constraint SQL manual §11.3).
- Sebutkan file dan fungsi yang diubah beserta alasan keputusannya.
