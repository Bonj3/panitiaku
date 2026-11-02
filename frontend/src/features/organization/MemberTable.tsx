import { useEffect, useState } from "react";
import { EmptyState } from "@/components/shared/EmptyState";
import {
  ErrorState,
  toFriendlyMessage,
} from "@/components/shared/ErrorState";
import { LoadingState } from "@/components/shared/LoadingState";
import { ApiError } from "@/lib/api-client";
import { ORG_ROLE_LABEL, ORG_STATUS_LABEL } from "./organization.types";
import { useMembers } from "./use-organization";

const PER_PAGE = 10;

interface MemberTableProps {
  eventId: string;
  /** Id anggota terpilih (dari chart / tabel) untuk highlight baris. */
  selectedId: string | null;
  /** Klik baris → pilih anggota. */
  onSelect: (memberId: string) => void;
}

/**
 * Tabel anggota dengan filter q (debounce sederhana 300ms), role, status,
 * dan pagination prev/next. Klik baris → pilih anggota (sinkron dengan
 * panel detail & chart).
 */
export function MemberTable({ eventId, selectedId, onSelect }: MemberTableProps) {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [role, setRole] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);

  // Debounce sederhana: terapkan q ke query setelah 300ms tanpa ketikan.
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(query.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  const membersQuery = useMembers(eventId, {
    page,
    perPage: PER_PAGE,
    q: debouncedQuery,
    role,
    status,
  });

  const hasActiveFilter =
    debouncedQuery !== "" || role !== "" || status !== "";

  const resetFilters = () => {
    setQuery("");
    setDebouncedQuery("");
    setRole("");
    setStatus("");
    setPage(1);
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label
            htmlFor="members-q"
            className="mb-1 block text-xs font-semibold tracking-widest text-slate-500 uppercase"
          >
            Cari nama / email
          </label>
          <input
            id="members-q"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Ketik nama atau email…"
            className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400"
          />
        </div>
        <div>
          <label
            htmlFor="members-role"
            className="mb-1 block text-xs font-semibold tracking-widest text-slate-500 uppercase"
          >
            Peran
          </label>
          <select
            id="members-role"
            value={role}
            onChange={(event) => {
              setRole(event.target.value);
              setPage(1);
            }}
            className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
          >
            <option value="">Semua peran</option>
            <option value="EVENT_CHAIR">Ketua Event</option>
            <option value="DIVISION_LEADER">Ketua Divisi</option>
            <option value="MEMBER">Anggota</option>
          </select>
        </div>
        <div>
          <label
            htmlFor="members-status"
            className="mb-1 block text-xs font-semibold tracking-widest text-slate-500 uppercase"
          >
            Status
          </label>
          <select
            id="members-status"
            value={status}
            onChange={(event) => {
              setStatus(event.target.value);
              setPage(1);
            }}
            className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
          >
            <option value="">Semua status</option>
            <option value="ACTIVE">Aktif</option>
            <option value="INACTIVE">Nonaktif</option>
          </select>
        </div>
      </div>

      {membersQuery.isLoading ? (
        <LoadingState label="Memuat daftar anggota…" />
      ) : membersQuery.error ? (
        membersQuery.error instanceof ApiError &&
        membersQuery.error.status === 403 ? (
          <ErrorState
            title="Tidak punya akses ke daftar anggota"
            error="Anda bukan anggota aktif event ini."
          />
        ) : (
          <ErrorState
            error={membersQuery.error}
            onRetry={() => membersQuery.refetch()}
          />
        )
      ) : membersQuery.data ? (
        membersQuery.data.items.length === 0 ? (
          <EmptyState
            title={
              hasActiveFilter
                ? "Tidak ada anggota yang cocok"
                : "Belum ada anggota"
            }
            description={
              hasActiveFilter
                ? "Coba ubah kata kunci atau filter yang dipakai."
                : "Event ini belum memiliki anggota selain Anda."
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
            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full min-w-[640px] border-collapse bg-white text-sm">
                <caption className="sr-only">
                  Daftar anggota event. Klik baris untuk melihat detail.
                </caption>
                <thead>
                  <tr className="bg-slate-50 text-left text-xs tracking-wider text-slate-500 uppercase">
                    <th scope="col" className="px-4 py-2.5 font-semibold">
                      Nama
                    </th>
                    <th scope="col" className="px-4 py-2.5 font-semibold">
                      Peran
                    </th>
                    <th scope="col" className="px-4 py-2.5 font-semibold">
                      Status
                    </th>
                    <th scope="col" className="px-4 py-2.5 font-semibold">
                      Jabatan
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {membersQuery.data.items.map((item) => {
                    const selected = item.id === selectedId;
                    const inactive = item.status === "INACTIVE";
                    return (
                      <tr
                        key={item.id}
                        onClick={() => onSelect(item.id)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            onSelect(item.id);
                          }
                        }}
                        tabIndex={0}
                        role="button"
                        aria-label={`Lihat detail ${item.name}`}
                        aria-current={selected ? "true" : undefined}
                        className={`cursor-pointer border-t border-slate-100 transition ${
                          selected
                            ? "bg-slate-900/[0.06]"
                            : "hover:bg-slate-50"
                        } ${inactive ? "opacity-60" : ""}`}
                      >
                        <td className="px-4 py-2.5 font-medium text-slate-900">
                          {item.name}
                        </td>
                        <td className="px-4 py-2.5 text-slate-700">
                          {ORG_ROLE_LABEL[item.role]}
                        </td>
                        <td
                          className={`px-4 py-2.5 font-medium ${inactive ? "text-slate-400" : "text-emerald-700"}`}
                        >
                          {ORG_STATUS_LABEL[item.status]}
                        </td>
                        <td className="px-4 py-2.5 text-slate-600">
                          {item.title ?? "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {membersQuery.isFetching ? (
              <p aria-live="polite" className="text-xs text-slate-500">
                Memperbarui data…
              </p>
            ) : null}

            <Pagination
              page={membersQuery.data.meta.page}
              totalPages={membersQuery.data.meta.totalPages}
              total={membersQuery.data.meta.total}
              onPrev={() => setPage((prev) => Math.max(1, prev - 1))}
              onNext={() => setPage((prev) => prev + 1)}
            />
          </>
        )
      ) : null}

      {/* Error non-fatal saat refetch background (data lama tetap tampil). */}
      {membersQuery.data && membersQuery.isError ? (
        <p role="alert" className="text-xs text-red-700">
          {toFriendlyMessage(membersQuery.error)}
        </p>
      ) : null}
    </div>
  );
}

interface PaginationProps {
  page: number;
  totalPages: number;
  total: number;
  onPrev: () => void;
  onNext: () => void;
}

function Pagination({ page, totalPages, total, onPrev, onNext }: PaginationProps) {
  const lastPage = Math.max(1, totalPages);
  return (
    <nav
      aria-label="Navigasi halaman anggota"
      className="flex items-center justify-between gap-3"
    >
      <p className="text-xs text-slate-500" aria-live="polite">
        Halaman {page} dari {lastPage} · {total} anggota
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onPrev}
          disabled={page <= 1}
          aria-label="Halaman sebelumnya"
          className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
        >
          ← Sebelumnya
        </button>
        <button
          type="button"
          onClick={onNext}
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
