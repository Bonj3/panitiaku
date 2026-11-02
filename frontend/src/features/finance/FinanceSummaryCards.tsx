import { toFriendlyMessage } from "@/components/shared/ErrorState";
import { formatCurrency } from "@/lib/format";
import type { FinanceSummary } from "./finance.types";

interface FinanceSummaryCardsProps {
  summary?: FinanceSummary | null;
  loading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  /** Versi lebih ringkas untuk overview EventDetailPage. */
  compact?: boolean;
}

/**
 * Empat kartu ringkasan keuangan: Saldo (paling menonjol), Pemasukan,
 * Pengeluaran, dan Menunggu Persetujuan.
 *
 * Semua nilai uang berasal langsung dari GET .../finance/summary (ledger).
 * Tidak ada perhitungan saldo dari daftar transaksi di sini.
 */
export function FinanceSummaryCards({
  summary,
  loading = false,
  error,
  onRetry,
  compact = false,
}: FinanceSummaryCardsProps) {
  const gridClass = compact
    ? "grid gap-3 sm:grid-cols-2"
    : "grid gap-3 sm:grid-cols-2 lg:grid-cols-4";

  if (loading && !summary) {
    return (
      <div className={gridClass} aria-busy="true" aria-live="polite">
        <span className="sr-only">Memuat ringkasan keuangan.</span>
        {[0, 1, 2, 3].map((index) => (
          <div
            key={index}
            className="animate-pulse rounded-lg border border-slate-200 bg-white p-5"
          >
            <div className="h-3 w-24 rounded bg-slate-200" />
            <div className="mt-3 h-7 w-32 rounded bg-slate-200" />
            <div className="mt-2 h-3 w-20 rounded bg-slate-100" />
          </div>
        ))}
      </div>
    );
  }

  if (!summary) {
    if (!error) return null;
    return (
      <div
        role="alert"
        className="flex flex-col gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 sm:flex-row sm:items-center sm:justify-between"
      >
        <p>Gagal memuat ringkasan keuangan: {toFriendlyMessage(error)}</p>
        {onRetry ? (
          <button
            type="button"
            onClick={onRetry}
            className="shrink-0 rounded-md border border-red-300 bg-white px-3 py-1.5 text-xs font-semibold text-red-800 hover:bg-red-100 focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2 focus-visible:outline-none"
          >
            Coba lagi
          </button>
        ) : null}
      </div>
    );
  }

  const negativeBalance = summary.balance.trim().startsWith("-");
  const valueClass = compact ? "text-lg" : "text-xl";
  const cardPadding = compact ? "p-4" : "p-5";

  return (
    <div className="space-y-3">
      {error ? (
        <div
          role="alert"
          className="flex flex-col gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800 sm:flex-row sm:items-center sm:justify-between"
        >
          <p>Ringkasan mungkin belum terbaru: {toFriendlyMessage(error)}</p>
          {onRetry ? (
            <button
              type="button"
              onClick={onRetry}
              className="shrink-0 rounded border border-red-300 bg-white px-2.5 py-1 font-semibold text-red-800 hover:bg-red-100"
            >
              Muat ulang
            </button>
          ) : null}
        </div>
      ) : null}

      <div className={gridClass}>
        <div
          className={`rounded-lg border border-slate-800 bg-slate-900 text-white shadow-sm ${cardPadding}`}
        >
          <p className="text-xs font-semibold tracking-widest text-slate-300 uppercase">
            Saldo
          </p>
          <p
            className={`mt-2 font-semibold break-all tabular-nums ${valueClass} ${
              negativeBalance ? "text-red-300" : "text-white"
            }`}
          >
            {formatCurrency(summary.balance)}
          </p>
          <p className="mt-1 text-xs text-slate-400">
            Dari ledger pembayaran
          </p>
        </div>

        <div
          className={`rounded-lg border border-slate-200 bg-white shadow-sm ${cardPadding}`}
        >
          <p className="text-xs font-semibold tracking-widest text-slate-500 uppercase">
            Pemasukan
          </p>
          <p
            className={`mt-2 font-semibold break-all text-emerald-700 tabular-nums ${valueClass}`}
          >
            {formatCurrency(summary.totalIncome)}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Total pembayaran masuk
          </p>
        </div>

        <div
          className={`rounded-lg border border-slate-200 bg-white shadow-sm ${cardPadding}`}
        >
          <p className="text-xs font-semibold tracking-widest text-slate-500 uppercase">
            Pengeluaran
          </p>
          <p
            className={`mt-2 font-semibold break-all text-red-700 tabular-nums ${valueClass}`}
          >
            {formatCurrency(summary.totalExpense)}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Total pembayaran keluar
          </p>
        </div>

        <div
          className={`rounded-lg border border-slate-200 bg-white shadow-sm ${cardPadding}`}
        >
          <p className="text-xs font-semibold tracking-widest text-slate-500 uppercase">
            Menunggu Persetujuan
          </p>
          <p
            className={`mt-2 font-semibold text-amber-700 tabular-nums ${valueClass}`}
          >
            {summary.pendingCount}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Transaksi berstatus diajukan
          </p>
        </div>
      </div>
    </div>
  );
}
