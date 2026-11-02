import { useState } from "react";
import { Dialog } from "@/components/shared/Dialog";
import { EmptyState } from "@/components/shared/EmptyState";
import {
  ErrorState,
  toFriendlyMessage,
} from "@/components/shared/ErrorState";
import { LoadingState } from "@/components/shared/LoadingState";
import { ApiError } from "@/lib/api-client";
import { formatDateTime } from "@/lib/format";
import { INVITATION_ROLE_LABEL, INVITATION_STATUS_LABEL } from "./invitation.types";
import type { InvitationListItem } from "./invitation.types";
import { useInvitations, useRevokeInvitation } from "./use-invitations";

const PER_PAGE = 20;
const STATUS_OPTIONS = ["", "PENDING", "ACCEPTED", "REVOKED", "EXPIRED"] as const;

interface InvitationListProps {
  eventId: string;
}

/**
 * Daftar undangan event: filter status + pagination + tombol "Cabut"
 * untuk PENDING (konfirmasi inline via Dialog, bukan window.confirm).
 */
export function InvitationList({ eventId }: InvitationListProps) {
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [revokeTarget, setRevokeTarget] = useState<InvitationListItem | null>(
    null,
  );

  const listQuery = useInvitations(eventId, {
    page,
    perPage: PER_PAGE,
    status,
  });

  const hasActiveFilter = status !== "";

  const resetFilters = () => {
    setStatus("");
    setPage(1);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="w-full sm:max-w-xs">
          <label
            htmlFor="invitations-status"
            className="mb-1 block text-xs font-semibold tracking-widest text-slate-500 uppercase"
          >
            Status
          </label>
          <select
            id="invitations-status"
            value={status}
            onChange={(event) => {
              setStatus(event.target.value);
              setPage(1);
            }}
            className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
          >
            <option value="">Semua status</option>
            {STATUS_OPTIONS.filter((option) => option !== "").map(
              (option) => (
                <option key={option} value={option}>
                  {INVITATION_STATUS_LABEL[
                    option as keyof typeof INVITATION_STATUS_LABEL
                  ]}
                </option>
              ),
            )}
          </select>
        </div>
        {hasActiveFilter ? (
          <button
            type="button"
            onClick={resetFilters}
            className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 sm:self-end"
          >
            Atur ulang filter
          </button>
        ) : null}
      </div>

      {listQuery.isLoading ? (
        <LoadingState label="Memuat daftar undangan…" />
      ) : listQuery.error ? (
        listQuery.error instanceof ApiError &&
        listQuery.error.status === 403 ? (
          <ErrorState
            title="Tidak punya akses ke daftar undangan"
            error="Hanya Ketua Event dan Ketua Divisi yang dapat melihat undangan."
          />
        ) : (
          <ErrorState
            error={listQuery.error}
            onRetry={() => listQuery.refetch()}
          />
        )
      ) : listQuery.data ? (
        listQuery.data.items.length === 0 ? (
          <EmptyState
            title={
              hasActiveFilter
                ? "Tidak ada undangan yang cocok"
                : "Belum ada undangan"
            }
            description={
              hasActiveFilter
                ? "Coba ubah filter status yang dipakai."
                : "Buat undangan pertama untuk menambah anggota ke event ini."
            }
          />
        ) : (
          <>
            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full min-w-[720px] border-collapse bg-white text-sm">
                <caption className="sr-only">
                  Daftar undangan event beserta statusnya.
                </caption>
                <thead>
                  <tr className="bg-slate-50 text-left text-xs tracking-wider text-slate-500 uppercase">
                    <th scope="col" className="px-4 py-2.5 font-semibold">
                      Email
                    </th>
                    <th scope="col" className="px-4 py-2.5 font-semibold">
                      Peran
                    </th>
                    <th scope="col" className="px-4 py-2.5 font-semibold">
                      Status
                    </th>
                    <th scope="col" className="px-4 py-2.5 font-semibold">
                      Diundang oleh
                    </th>
                    <th scope="col" className="px-4 py-2.5 font-semibold">
                      Kedaluwarsa
                    </th>
                    <th
                      scope="col"
                      className="px-4 py-2.5 text-right font-semibold"
                    >
                      Aksi
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {listQuery.data.items.map((item) => (
                    <tr
                      key={item.id}
                      className="border-t border-slate-100 transition hover:bg-slate-50"
                    >
                      <td className="px-4 py-2.5 font-medium text-slate-900">
                        {item.email}
                      </td>
                      <td className="px-4 py-2.5 text-slate-700">
                        {INVITATION_ROLE_LABEL[item.role]}
                      </td>
                      <td className="px-4 py-2.5">
                        <StatusBadge status={item.status} />
                      </td>
                      <td className="px-4 py-2.5 text-slate-600">
                        {item.invitedBy ? item.invitedBy.name : "—"}
                      </td>
                      <td className="px-4 py-2.5 text-slate-600">
                        {formatDateTime(item.expiresAt)}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        {item.status === "PENDING" ? (
                          <button
                            type="button"
                            onClick={() => setRevokeTarget(item)}
                            className="rounded-md border border-red-300 px-3 py-1.5 text-xs font-medium text-red-700 transition hover:bg-red-50"
                          >
                            Cabut
                          </button>
                        ) : (
                          <span className="text-xs text-slate-400">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {listQuery.isFetching ? (
              <p aria-live="polite" className="text-xs text-slate-500">
                Memperbarui data…
              </p>
            ) : null}

            <Pagination
              page={listQuery.data.meta.page}
              totalPages={listQuery.data.meta.totalPages}
              total={listQuery.data.meta.total}
              onPrev={() => setPage((prev) => Math.max(1, prev - 1))}
              onNext={() => setPage((prev) => prev + 1)}
            />
          </>
        )
      ) : null}

      {/* Error non-fatal saat refetch background (data lama tetap tampil). */}
      {listQuery.data && listQuery.isError ? (
        <p role="alert" className="text-xs text-red-700">
          {toFriendlyMessage(listQuery.error)}
        </p>
      ) : null}

      <RevokeDialog
        eventId={eventId}
        target={revokeTarget}
        onClose={() => setRevokeTarget(null)}
      />
    </div>
  );
}

const STATUS_BADGE_CLASS: Record<InvitationListItem["status"], string> = {
  PENDING: "bg-amber-100 text-amber-800",
  ACCEPTED: "bg-emerald-100 text-emerald-800",
  REVOKED: "bg-slate-200 text-slate-600",
  EXPIRED: "bg-slate-100 text-slate-500",
};

function StatusBadge({ status }: { status: InvitationListItem["status"] }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_BADGE_CLASS[status]}`}
    >
      {INVITATION_STATUS_LABEL[status]}
    </span>
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
      aria-label="Navigasi halaman undangan"
      className="flex items-center justify-between gap-3"
    >
      <p className="text-xs text-slate-500" aria-live="polite">
        Halaman {page} dari {lastPage} · {total} undangan
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

interface RevokeDialogProps {
  eventId: string;
  target: InvitationListItem | null;
  onClose: () => void;
}

/**
 * Konfirmasi inline pencabutan undangan PENDING.
 * 409 (sudah final) dilaporkan ramah; dialog tetap dapat ditutup.
 */
function RevokeDialog({ eventId, target, onClose }: RevokeDialogProps) {
  const revokeMutation = useRevokeInvitation(eventId);
  const [submitError, setSubmitError] = useState<unknown>(null);

  // Reset error setiap target dialog berganti.
  const [lastTargetId, setLastTargetId] = useState<string | null>(null);
  if ((target?.id ?? null) !== lastTargetId) {
    setLastTargetId(target?.id ?? null);
    if (submitError) setSubmitError(null);
    if (revokeMutation.isError) revokeMutation.reset();
  }

  const displayError = submitError ?? revokeMutation.error;

  const handleRevoke = async () => {
    if (!target) return;
    setSubmitError(null);
    try {
      await revokeMutation.mutateAsync({ invitationId: target.id });
      onClose();
    } catch (err) {
      setSubmitError(err);
    }
  };

  return (
    <Dialog
      title="Cabut undangan?"
      description={
        target
          ? `Undangan untuk ${target.email} (${INVITATION_ROLE_LABEL[target.role]}) akan dibatalkan dan link-nya tidak berlaku lagi.`
          : undefined
      }
      open={target !== null}
      onClose={() => {
        if (!revokeMutation.isPending) onClose();
      }}
    >
      {displayError ? (
        <div
          role="alert"
          className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
        >
          {displayError instanceof ApiError && displayError.status === 409
            ? "Undangan sudah tidak dapat dicabut (sudah diterima, dicabut, atau kedaluwarsa). Daftar akan diperbarui."
            : toFriendlyMessage(displayError)}
        </div>
      ) : null}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button
          type="button"
          onClick={onClose}
          disabled={revokeMutation.isPending}
          className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-60"
        >
          Batal
        </button>
        <button
          type="button"
          onClick={() => void handleRevoke()}
          disabled={revokeMutation.isPending}
          className="rounded-md bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-red-600 disabled:opacity-60"
        >
          {revokeMutation.isPending ? "Mencabut…" : "Ya, cabut undangan"}
        </button>
      </div>
    </Dialog>
  );
}
