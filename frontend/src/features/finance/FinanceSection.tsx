import { useState } from "react";
import { EmptyState } from "@/components/shared/EmptyState";
import {
  ErrorState,
  toFriendlyMessage,
} from "@/components/shared/ErrorState";
import { LoadingState } from "@/components/shared/LoadingState";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { formatCurrency, formatDate } from "@/lib/format";
import { TransactionFormDialog } from "./TransactionFormDialog";
import { TransactionStatusBadge } from "./TransactionStatusBadge";
import { canCreateTransaction } from "./finance.permissions";
import type { FinanceActor } from "./finance.permissions";
import {
  TRANSACTION_CATEGORIES,
  TRANSACTION_CATEGORY_LABEL,
  TRANSACTION_STATUSES,
  TRANSACTION_STATUS_LABEL,
  TRANSACTION_TYPE_LABEL,
} from "./finance.types";
import type {
  TransactionCategory,
  TransactionItem,
  TransactionStatus,
  TransactionType,
} from "./finance.types";
import { useTransactions } from "./use-finance";

const PER_PAGE_OPTIONS = [10, 20, 50] as const;

const selectClass =
  "w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-500 focus:ring-1 focus:ring-slate-500 focus:outline-none disabled:opacity-60";

interface FinanceSectionProps {
  eventId: string;
  actor: FinanceActor;
  eventStatus: string;
  /** Buka detail transaksi (navigasi deep link di FinancePage). */
  onOpenTransaction: (transactionId: string) => void;
}

/**
 * Daftar transaksi: toolbar pencarian/filter, tabel desktop, kartu mobile,
 * pagination, serta create dialog. Ringkasan saldo TIDAK dihitung di sini.
 */
export function FinanceSection({
  eventId,
  actor,
  eventStatus,
  onOpenTransaction,
}: FinanceSectionProps) {
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 300);
  const [statusFilter, setStatusFilter] = useState<TransactionStatus | "">("");
  const [typeFilter, setTypeFilter] = useState<TransactionType | "">("");
  const [categoryFilter, setCategoryFilter] = useState<
    TransactionCategory | ""
  >("");
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState<number>(10);
  const [createOpen, setCreateOpen] = useState(false);
  const [created, setCreated] = useState<TransactionItem | null>(null);

  const listQuery = useTransactions(eventId, {
    page,
    perPage,
    q: debouncedSearch.trim(),
    status: statusFilter || undefined,
    type: typeFilter || undefined,
    category: categoryFilter || undefined,
  });

  const hasActiveFilter =
    search.trim() !== "" ||
    statusFilter !== "" ||
    typeFilter !== "" ||
    categoryFilter !== "";

  const canCreate = canCreateTransaction(actor, eventStatus);

  const resetFilters = () => {
    setSearch("");
    setStatusFilter("");
    setTypeFilter("");
    setCategoryFilter("");
    setPage(1);
  };

  const handleTypeChange = (next: TransactionType | "") => {
    setTypeFilter(next);
    setPage(1);
    if (next && categoryFilter) {
      const allowed = TRANSACTION_CATEGORIES[next] as readonly string[];
      if (!allowed.includes(categoryFilter)) setCategoryFilter("");
    }
  };

  const categoryOptions: readonly TransactionCategory[] =
    typeFilter === "INCOME"
      ? TRANSACTION_CATEGORIES.INCOME
      : typeFilter === "EXPENSE"
        ? TRANSACTION_CATEGORIES.EXPENSE
        : [
            ...TRANSACTION_CATEGORIES.INCOME,
            ...TRANSACTION_CATEGORIES.EXPENSE,
          ];

  return (
    <section
      aria-label="Daftar transaksi"
      className="rounded-lg border border-slate-200 bg-white shadow-sm"
    >
      <div className="flex flex-col gap-3 border-b border-slate-200 p-5 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Transaksi</h2>
          <p className="mt-1 text-sm text-slate-600">
            {listQuery.data
              ? `${listQuery.data.meta.total} transaksi`
              : "Riwayat pemasukan dan pengeluaran event."}
          </p>
        </div>
        {canCreate ? (
          <button
            type="button"
            onClick={() => {
              setCreated(null);
              setCreateOpen(true);
            }}
            className="shrink-0 rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-700 focus-visible:ring-2 focus-visible:ring-slate-500 focus-visible:ring-offset-2 focus-visible:outline-none"
          >
            Transaksi baru
          </button>
        ) : null}
      </div>

      <div className="space-y-4 p-5">
        {created ? (
          <div
            role="status"
            className="flex flex-col gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 sm:flex-row sm:items-center sm:justify-between"
          >
            <p>
              Transaksi &quot;{created.description}&quot; berhasil dibuat
              sebagai draf.
            </p>
            <button
              type="button"
              onClick={() => onOpenTransaction(created.id)}
              className="shrink-0 text-left text-sm font-semibold underline underline-offset-4 hover:text-emerald-900"
            >
              Lihat detail
            </button>
          </div>
        ) : null}

        <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
          <div className="grid flex-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="sm:col-span-2 lg:col-span-1">
              <label
                htmlFor="finance-search"
                className="mb-1 block text-xs font-semibold tracking-widest text-slate-500 uppercase"
              >
                Cari deskripsi
              </label>
              <input
                id="finance-search"
                type="search"
                value={search}
                maxLength={100}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(1);
                }}
                placeholder="Ketik deskripsi transaksi."
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-500 focus:ring-1 focus:ring-slate-500 focus:outline-none"
              />
            </div>

            <div>
              <label
                htmlFor="finance-status"
                className="mb-1 block text-xs font-semibold tracking-widest text-slate-500 uppercase"
              >
                Status
              </label>
              <select
                id="finance-status"
                value={statusFilter}
                onChange={(event) => {
                  setStatusFilter(
                    event.target.value as TransactionStatus | "",
                  );
                  setPage(1);
                }}
                className={selectClass}
              >
                <option value="">Semua status</option>
                {TRANSACTION_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {TRANSACTION_STATUS_LABEL[status]}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                htmlFor="finance-type"
                className="mb-1 block text-xs font-semibold tracking-widest text-slate-500 uppercase"
              >
                Tipe
              </label>
              <select
                id="finance-type"
                value={typeFilter}
                onChange={(event) =>
                  handleTypeChange(event.target.value as TransactionType | "")
                }
                className={selectClass}
              >
                <option value="">Semua tipe</option>
                <option value="INCOME">
                  {TRANSACTION_TYPE_LABEL.INCOME}
                </option>
                <option value="EXPENSE">
                  {TRANSACTION_TYPE_LABEL.EXPENSE}
                </option>
              </select>
            </div>

            <div>
              <label
                htmlFor="finance-category"
                className="mb-1 block text-xs font-semibold tracking-widest text-slate-500 uppercase"
              >
                Kategori
              </label>
              <select
                id="finance-category"
                value={categoryFilter}
                onChange={(event) => {
                  setCategoryFilter(
                    event.target.value as TransactionCategory | "",
                  );
                  setPage(1);
                }}
                className={selectClass}
              >
                <option value="">Semua kategori</option>
                {categoryOptions.map((category) => (
                  <option key={category} value={category}>
                    {TRANSACTION_CATEGORY_LABEL[category]}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {hasActiveFilter ? (
            <button
              type="button"
              onClick={resetFilters}
              className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 lg:shrink-0"
            >
              Atur ulang filter
            </button>
          ) : null}
        </div>

        {listQuery.isLoading ? (
          <LoadingState label="Memuat daftar transaksi." />
        ) : listQuery.error && !listQuery.data ? (
          <ErrorState
            error={listQuery.error}
            onRetry={() => listQuery.refetch()}
          />
        ) : listQuery.data ? (
          listQuery.data.items.length === 0 ? (
            <EmptyState
              title={
                hasActiveFilter
                  ? "Tidak ada transaksi yang cocok"
                  : "Belum ada transaksi"
              }
              description={
                hasActiveFilter
                  ? "Coba ubah kata kunci atau filter yang dipakai."
                  : canCreate
                    ? "Catat pemasukan atau pengeluaran pertama untuk event ini."
                    : "Belum ada transaksi yang tercatat pada event ini."
              }
              action={
                hasActiveFilter ? (
                  <button
                    type="button"
                    onClick={resetFilters}
                    className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
                  >
                    Atur ulang filter
                  </button>
                ) : undefined
              }
            />
          ) : (
            <>
              <TransactionTable
                items={listQuery.data.items}
                onOpenTransaction={onOpenTransaction}
              />

              <TransactionCards
                items={listQuery.data.items}
                onOpenTransaction={onOpenTransaction}
              />

              {listQuery.isFetching ? (
                <p aria-live="polite" className="text-xs text-slate-500">
                  Memperbarui data.
                </p>
              ) : null}

              {listQuery.isError ? (
                <p role="alert" className="text-xs text-red-700">
                  {toFriendlyMessage(listQuery.error)} Data sebelumnya tetap
                  ditampilkan.
                </p>
              ) : null}

              <Pagination
                page={listQuery.data.meta.page}
                totalPages={listQuery.data.meta.totalPages}
                total={listQuery.data.meta.total}
                perPage={perPage}
                onPageChange={(nextPage) => setPage(nextPage)}
                onPerPageChange={(nextPerPage) => {
                  setPerPage(nextPerPage);
                  setPage(1);
                }}
              />
            </>
          )
        ) : null}
      </div>

      <TransactionFormDialog
        eventId={eventId}
        mode="create"
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onSaved={(transaction) => {
          setCreated(transaction);
          setPage(1);
        }}
      />
    </section>
  );
}

function amountClass(type: TransactionItem["type"]): string {
  return type === "INCOME" ? "text-emerald-700" : "text-red-700";
}

function amountSign(type: TransactionItem["type"]): string {
  return type === "INCOME" ? "+" : "-";
}

function TransactionTable({
  items,
  onOpenTransaction,
}: {
  items: TransactionItem[];
  onOpenTransaction: (transactionId: string) => void;
}) {
  return (
    <div className="hidden overflow-x-auto rounded-lg border border-slate-200 md:block">
      <table className="w-full min-w-[760px] border-collapse bg-white text-sm">
        <caption className="sr-only">
          Daftar transaksi event. Klik baris atau tombol Detail untuk membuka
          detail.
        </caption>
        <thead>
          <tr className="bg-slate-50 text-left text-xs tracking-wider text-slate-500 uppercase">
            <th scope="col" className="px-3 py-2.5 font-semibold">
              Tanggal
            </th>
            <th scope="col" className="px-3 py-2.5 font-semibold">
              Deskripsi
            </th>
            <th scope="col" className="px-3 py-2.5 font-semibold">
              Tipe
            </th>
            <th scope="col" className="px-3 py-2.5 text-right font-semibold">
              Nominal
            </th>
            <th scope="col" className="px-3 py-2.5 font-semibold">
              Status
            </th>
            <th scope="col" className="px-3 py-2.5 font-semibold">
              Pengaju
            </th>
            <th scope="col" className="px-3 py-2.5 text-right font-semibold">
              Aksi
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr
              key={item.id}
              onClick={() => onOpenTransaction(item.id)}
              className="cursor-pointer border-t border-slate-100 transition hover:bg-slate-50"
            >
              <td className="px-3 py-3 whitespace-nowrap text-slate-600">
                {formatDate(item.createdAt)}
              </td>
              <td className="px-3 py-3">
                <p className="font-medium text-slate-900">{item.description}</p>
                <p className="mt-0.5 text-xs text-slate-500">
                  {TRANSACTION_CATEGORY_LABEL[
                    item.category as TransactionCategory
                  ] ?? item.category}
                </p>
              </td>
              <td className="px-3 py-3 whitespace-nowrap text-slate-700">
                {TRANSACTION_TYPE_LABEL[item.type]}
              </td>
              <td className="px-3 py-3 text-right font-medium whitespace-nowrap tabular-nums">
                <span className={amountClass(item.type)}>
                  {amountSign(item.type)}
                  {formatCurrency(item.amount)}
                </span>
              </td>
              <td className="px-3 py-3">
                <TransactionStatusBadge status={item.status} />
              </td>
              <td className="px-3 py-3 whitespace-nowrap text-slate-600">
                {item.submitter?.name ?? "-"}
              </td>
              <td className="px-3 py-3 text-right">
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    onOpenTransaction(item.id);
                  }}
                  className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
                >
                  Detail
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TransactionCards({
  items,
  onOpenTransaction,
}: {
  items: TransactionItem[];
  onOpenTransaction: (transactionId: string) => void;
}) {
  return (
    <ul className="space-y-3 md:hidden">
      {items.map((item) => (
        <li key={item.id}>
          <button
            type="button"
            onClick={() => onOpenTransaction(item.id)}
            className="w-full rounded-lg border border-slate-200 bg-white p-4 text-left transition hover:border-slate-400 focus-visible:ring-2 focus-visible:ring-slate-500 focus-visible:ring-offset-2 focus-visible:outline-none"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs text-slate-500">
                  {formatDate(item.createdAt)} ·{" "}
                  {TRANSACTION_TYPE_LABEL[item.type]}
                </p>
                <p className="mt-1 font-medium text-slate-900">
                  {item.description}
                </p>
                <p className="mt-0.5 text-xs text-slate-500">
                  {TRANSACTION_CATEGORY_LABEL[
                    item.category as TransactionCategory
                  ] ?? item.category}
                </p>
              </div>
              <TransactionStatusBadge status={item.status} />
            </div>
            <div className="mt-3 flex items-end justify-between gap-3">
              <p className="text-xs text-slate-500">
                Pengaju: {item.submitter?.name ?? "-"}
              </p>
              <p
                className={`text-right font-semibold break-all tabular-nums ${amountClass(item.type)}`}
              >
                {amountSign(item.type)}
                {formatCurrency(item.amount)}
              </p>
            </div>
            <p className="mt-2 text-right text-xs font-medium text-slate-600">
              Lihat detail
            </p>
          </button>
        </li>
      ))}
    </ul>
  );
}

function Pagination({
  page,
  totalPages,
  total,
  perPage,
  onPageChange,
  onPerPageChange,
}: {
  page: number;
  totalPages: number;
  total: number;
  perPage: number;
  onPageChange: (page: number) => void;
  onPerPageChange: (perPage: number) => void;
}) {
  const lastPage = Math.max(1, totalPages);

  return (
    <nav
      aria-label="Navigasi halaman transaksi"
      className="flex flex-col gap-3 border-t border-slate-100 pt-4 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-xs text-slate-500" aria-live="polite">
          Halaman {page} dari {lastPage} · {total} transaksi
        </p>
        <label
          htmlFor="finance-per-page"
          className="text-xs text-slate-500"
        >
          Baris per halaman
        </label>
        <select
          id="finance-per-page"
          value={perPage}
          onChange={(event) => onPerPageChange(Number(event.target.value))}
          className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 focus:border-slate-500 focus:ring-1 focus:ring-slate-500 focus:outline-none"
        >
          {PER_PAGE_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => onPageChange(Math.max(1, page - 1))}
          disabled={page <= 1}
          aria-label="Halaman sebelumnya"
          className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
        >
          ← Sebelumnya
        </button>
        <button
          type="button"
          onClick={() => onPageChange(page + 1)}
          disabled={page >= lastPage}
          aria-label="Halaman berikutnya"
          className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Berikutnya →
        </button>
      </div>
    </nav>
  );
}
