import type { TransactionStatus } from "./finance.types";

/**
 * Helper izin sisi klien untuk keuangan - HANYA untuk menyembunyikan tombol.
 * Backend tetap satu-satunya penegak otorisasi (PROJECT.md §4.4, §5.C).
 *
 * Semua fungsi murni (tanpa React) sehingga mudah diuji unit.
 */

export interface FinanceActor {
  /** Id event-member aktor (= membership.id, bukan user id). */
  id: string;
  role: string;
}

export interface FinanceTransactionTarget {
  status: TransactionStatus;
  submitter: { id: string } | null;
}

function isChair(actor: FinanceActor): boolean {
  return actor.role === "EVENT_CHAIR";
}

function isOwner(
  actor: FinanceActor,
  transaction: FinanceTransactionTarget,
): boolean {
  return (
    transaction.submitter !== null && transaction.submitter.id === actor.id
  );
}

function isOwnerOrChair(
  actor: FinanceActor,
  transaction: FinanceTransactionTarget,
): boolean {
  return isOwner(actor, transaction) || isChair(actor);
}

/** Semua anggota aktif boleh membuat transaksi, hanya saat event OPEN. */
export function canCreateTransaction(
  _actor: FinanceActor,
  eventStatus: string,
): boolean {
  return eventStatus === "OPEN";
}

/** Edit hanya DRAFT, oleh pemilik atau Chair. */
export function canEditTransaction(
  actor: FinanceActor,
  _eventStatus: string,
  transaction: FinanceTransactionTarget,
): boolean {
  if (transaction.status !== "DRAFT") return false;
  return isOwnerOrChair(actor, transaction);
}

/** Ajukan DRAFT ke SUBMITTED: pemilik/Chair + event OPEN. */
export function canSubmitTransaction(
  actor: FinanceActor,
  eventStatus: string,
  transaction: FinanceTransactionTarget,
): boolean {
  if (eventStatus !== "OPEN") return false;
  if (transaction.status !== "DRAFT") return false;
  return isOwnerOrChair(actor, transaction);
}

/** Approve/reject hanya Chair, SUBMITTED, event OPEN. */
export function canApproveTransaction(
  actor: FinanceActor,
  eventStatus: string,
  transaction: FinanceTransactionTarget,
): boolean {
  return (
    isChair(actor) &&
    eventStatus === "OPEN" &&
    transaction.status === "SUBMITTED"
  );
}

export function canRejectTransaction(
  actor: FinanceActor,
  eventStatus: string,
  transaction: FinanceTransactionTarget,
): boolean {
  return canApproveTransaction(actor, eventStatus, transaction);
}

/** Catat pembayaran hanya Chair, APPROVED, event OPEN. */
export function canPayTransaction(
  actor: FinanceActor,
  eventStatus: string,
  transaction: FinanceTransactionTarget,
): boolean {
  return (
    isChair(actor) &&
    eventStatus === "OPEN" &&
    transaction.status === "APPROVED"
  );
}

/**
 * Batalkan:
 * - DRAFT/SUBMITTED/REJECTED: pemilik atau Chair;
 * - APPROVED: hanya Chair;
 * - status lain tidak dapat dibatalkan.
 */
export function canCancelTransaction(
  actor: FinanceActor,
  _eventStatus: string,
  transaction: FinanceTransactionTarget,
): boolean {
  switch (transaction.status) {
    case "DRAFT":
    case "SUBMITTED":
    case "REJECTED":
      return isOwnerOrChair(actor, transaction);
    case "APPROVED":
      return isChair(actor);
    default:
      return false;
  }
}

/** Buka kembali REJECTED → DRAFT: pemilik/Chair + event OPEN. */
export function canReopenTransaction(
  actor: FinanceActor,
  eventStatus: string,
  transaction: FinanceTransactionTarget,
): boolean {
  if (eventStatus !== "OPEN") return false;
  if (transaction.status !== "REJECTED") return false;
  return isOwnerOrChair(actor, transaction);
}

/** Reversal hanya Chair untuk transaksi PAID. */
export function canReverseTransaction(
  actor: FinanceActor,
  _eventStatus: string,
  transaction: FinanceTransactionTarget,
): boolean {
  return isChair(actor) && transaction.status === "PAID";
}
