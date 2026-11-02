import {
  TRANSACTION_STATUS_LABEL,
  type TransactionStatus,
} from "./finance.types";

const STATUS_BADGE_CLASS: Record<TransactionStatus, string> = {
  DRAFT: "bg-slate-100 text-slate-700",
  SUBMITTED: "bg-amber-100 text-amber-800",
  APPROVED: "bg-emerald-50 text-emerald-700",
  REJECTED: "bg-red-100 text-red-800",
  PAID: "bg-emerald-100 text-emerald-800",
  CANCELLED: "bg-slate-200 text-slate-500",
};

interface TransactionStatusBadgeProps {
  status: TransactionStatus;
  className?: string;
}

/** Satu badge status transaksi dengan label teks (tidak hanya warna). */
export function TransactionStatusBadge({
  status,
  className = "",
}: TransactionStatusBadgeProps) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap ${STATUS_BADGE_CLASS[status]} ${className}`}
    >
      {TRANSACTION_STATUS_LABEL[status]}
    </span>
  );
}
