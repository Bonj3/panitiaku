import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Dialog } from "@/components/shared/Dialog";
import { ErrorState } from "@/components/shared/ErrorState";
import { LoadingState } from "@/components/shared/LoadingState";
import { ApiError } from "@/lib/api-client";
import { formatCurrency, formatDateTime } from "@/lib/format";
import { toFriendlyFinanceError } from "./finance.errors";
import {
  canApproveTransaction,
  canCancelTransaction,
  canEditTransaction,
  canPayTransaction,
  canRejectTransaction,
  canReopenTransaction,
  canReverseTransaction,
  canSubmitTransaction,
} from "./finance.permissions";
import type { FinanceActor } from "./finance.permissions";
import {
  TRANSACTION_STATUS_LABEL,
  TRANSACTION_TYPE_LABEL,
  transactionCategoryLabel,
} from "./finance.types";
import type {
  TransactionDetail,
  TransactionLedgerEntry,
  TransactionStatus,
} from "./finance.types";
import { TransactionFormDialog } from "./TransactionFormDialog";
import { financeService } from "./finance.service";
import { TransactionStatusBadge } from "./TransactionStatusBadge";
import {
  useApproveTransaction,
  useCancelTransaction,
  usePayTransaction,
  useRejectTransaction,
  useReopenTransaction,
  useReverseTransaction,
  useSubmitTransaction,
  useTransaction,
} from "./use-finance";

type ActionKind =
  | "submit"
  | "approve"
  | "reject"
  | "reopen"
  | "pay"
  | "cancel"
  | "reverse";

const ACTION_TITLE: Record<ActionKind, string> = {
  submit: "Ajukan transaksi?",
  approve: "Setujui transaksi?",
  reject: "Tolak transaksi?",
  reopen: "Buka kembali transaksi?",
  pay: "Catat pembayaran?",
  cancel: "Batalkan transaksi?",
  reverse: "Catat reversal?",
};

const ACTION_CONFIRM_LABEL: Record<ActionKind, string> = {
  submit: "Ya, ajukan",
  approve: "Ya, setujui",
  reject: "Ya, tolak",
  reopen: "Ya, buka kembali",
  pay: "Ya, catat pembayaran",
  cancel: "Ya, batalkan",
  reverse: "Ya, catat reversal",
};

interface TransactionDetailPanelProps {
  eventId: string;
  transactionId: string;
  actor: FinanceActor;
  eventStatus: string;
  onClose: () => void;
}

/**
 * Panel detail transaksi (deep link) + timeline history + ledger.
 * Aksi tampil sesuai permission display-only; backend tetap penegak.
 */
export function TransactionDetailPanel({
  eventId,
  transactionId,
  actor,
  eventStatus,
  onClose,
}: TransactionDetailPanelProps) {
  const detailQuery = useTransaction(eventId, transactionId);
  const evidenceQuery = useQuery({ queryKey: ["events", eventId, "transactions", transactionId, "evidence"], queryFn: () => financeService.listEvidence(eventId, transactionId), retry: false });
  const auditQuery = useQuery({ queryKey: ["events", eventId, "audit", transactionId], queryFn: () => financeService.listAuditLogs(eventId, transactionId), enabled: actor.role === "EVENT_CHAIR", retry: false });
  const uploadMutation = useMutation({ mutationFn: (file: File) => financeService.uploadEvidence(eventId, transactionId, file), onSuccess: () => { void evidenceQuery.refetch(); } });
  const sensitiveMutation = useMutation({ mutationFn: ({id, sensitive}: {id: string; sensitive: boolean}) => financeService.updateEvidenceSensitive(eventId, transactionId, id, sensitive), onSuccess: () => { void evidenceQuery.refetch(); } });
  const [fileError, setFileError] = useState<string | null>(null);
  const [evidenceError, setEvidenceError] = useState<string | null>(null);

  const submitMutation = useSubmitTransaction(eventId);
  const approveMutation = useApproveTransaction(eventId);
  const rejectMutation = useRejectTransaction(eventId);
  const reopenMutation = useReopenTransaction(eventId);
  const payMutation = usePayTransaction(eventId);
  const cancelMutation = useCancelTransaction(eventId);
  const reverseMutation = useReverseTransaction(eventId);

  const [action, setAction] = useState<ActionKind | null>(null);
  const [formValue, setFormValue] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);

  const transaction = detailQuery.data;

  const pending =
    action === "submit"
      ? submitMutation.isPending
      : action === "approve"
        ? approveMutation.isPending
        : action === "reject"
          ? rejectMutation.isPending
          : action === "reopen"
            ? reopenMutation.isPending
            : action === "pay"
              ? payMutation.isPending
              : action === "cancel"
                ? cancelMutation.isPending
                : action === "reverse"
                  ? reverseMutation.isPending
                  : false;

  const openAction = (kind: ActionKind) => {
    setAction(kind);
    setFormValue("");
    setFormError(null);
    setSubmitError(null);
  };

  const closeAction = () => {
    if (pending) return;
    setAction(null);
    setFormValue("");
    setFormError(null);
    setSubmitError(null);
  };

  const runAction = async () => {
    if (!action || !transaction) return;
    setSubmitError(null);
    setFormError(null);

    const trimmed = formValue.trim();
    if ((action === "reject" || action === "reverse") && trimmed.length < 3) {
      setFormError(
        action === "reject"
          ? "Alasan penolakan minimal 3 karakter."
          : "Alasan reversi minimal 3 karakter.",
      );
      return;
    }

    try {
      switch (action) {
        case "submit":
          await submitMutation.mutateAsync({
            transactionId: transaction.id,
          });
          setNotice("Transaksi berhasil diajukan untuk persetujuan.");
          break;
        case "approve":
          await approveMutation.mutateAsync({
            transactionId: transaction.id,
          });
          setNotice("Transaksi disetujui.");
          break;
        case "reject":
          await rejectMutation.mutateAsync({
            transactionId: transaction.id,
            reason: trimmed,
          });
          setNotice("Transaksi ditolak. Alasan tercatat pada riwayat.");
          break;
        case "reopen":
          await reopenMutation.mutateAsync({
            transactionId: transaction.id,
          });
          setNotice("Transaksi dibuka kembali sebagai draf.");
          break;
        case "pay":
          await payMutation.mutateAsync({
            transactionId: transaction.id,
            narration: trimmed || null,
          });
          setNotice("Pembayaran dicatat dan ledger diperbarui.");
          break;
        case "cancel":
          await cancelMutation.mutateAsync({
            transactionId: transaction.id,
            reason: trimmed || null,
          });
          setNotice("Transaksi dibatalkan.");
          break;
        case "reverse":
          await reverseMutation.mutateAsync({
            transactionId: transaction.id,
            reason: trimmed,
          });
          setNotice("Reversal dicatat. Saldo mengikuti ledger terbaru.");
          break;
      }
      setAction(null);
      setFormValue("");
    } catch (err) {
      setSubmitError(err);
    }
  };

  const canEdit = transaction
    ? canEditTransaction(actor, eventStatus, transaction)
    : false;
  const canSubmit = transaction
    ? canSubmitTransaction(actor, eventStatus, transaction)
    : false;
  const canApprove = transaction
    ? canApproveTransaction(actor, eventStatus, transaction)
    : false;
  const canReject = transaction
    ? canRejectTransaction(actor, eventStatus, transaction)
    : false;
  const canPay = transaction
    ? canPayTransaction(actor, eventStatus, transaction)
    : false;
  const canCancel = transaction
    ? canCancelTransaction(actor, eventStatus, transaction)
    : false;
  const canReopen = transaction
    ? canReopenTransaction(actor, eventStatus, transaction)
    : false;
  const canReverse = transaction
    ? canReverseTransaction(actor, eventStatus, transaction)
    : false;

  const requiresReason = action === "reject" || action === "reverse";
  const hasOptionalText = action === "pay" || action === "cancel";

  return (
    <section
      aria-label="Detail transaksi"
      className="rounded-lg border border-slate-200 bg-white shadow-sm"
    >
      <div className="flex flex-col gap-3 border-b border-slate-200 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-semibold tracking-widest text-slate-500 uppercase">
            Detail transaksi
          </p>
          <h2 className="mt-1 text-base font-semibold text-slate-900">
            {transaction ? transaction.description : "Memuat transaksi."}
          </h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-slate-500 focus-visible:ring-offset-2 focus-visible:outline-none"
        >
          ← Kembali ke daftar
        </button>
      </div>

      {detailQuery.isLoading && !transaction ? (
        <div className="p-5">
          <LoadingState label="Memuat detail transaksi." />
        </div>
      ) : transaction ? (
        <div className="space-y-6 p-5">
          {notice ? (
            <div
              role="status"
              className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800"
            >
              {notice}
            </div>
          ) : null}

          {detailQuery.error ? (
            <p role="alert" className="text-sm text-red-700">
              Gagal memperbarui detail:{" "}
              {toFriendlyFinanceError(detailQuery.error)}
            </p>
          ) : null}

          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                  transaction.type === "INCOME"
                    ? "bg-emerald-100 text-emerald-800"
                    : "bg-red-100 text-red-800"
                }`}
              >
                {TRANSACTION_TYPE_LABEL[transaction.type]}
              </span>
              <TransactionStatusBadge status={transaction.status} />
            </div>
            <p
              className={`mt-3 text-2xl font-bold break-all tabular-nums ${
                transaction.type === "INCOME"
                  ? "text-emerald-700"
                  : "text-red-700"
              }`}
            >
              {transaction.type === "INCOME" ? "+" : "-"}
              {formatCurrency(transaction.amount)}
            </p>
            <p className="mt-1 text-sm text-slate-600">
              {transaction.description}
            </p>
          </div>

          {transaction.rejectReason ? (
            <div
              role="alert"
              className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
            >
              <p className="font-semibold">Alasan penolakan</p>
              <p className="mt-1">{transaction.rejectReason}</p>
            </div>
          ) : null}

          <dl className="grid gap-4 sm:grid-cols-2">
            <MetaItem label="Kategori">
              {transactionCategoryLabel(transaction.category)}
            </MetaItem>
            <MetaItem label="Mata uang">{transaction.currency}</MetaItem>
            <MetaItem label="Diajukan oleh">
              {transaction.submitter?.name ?? "-"}
              {transaction.submittedAt
                ? ` · ${formatDateTime(transaction.submittedAt)}`
                : ""}
            </MetaItem>
            <MetaItem label="Disetujui oleh">
              {transaction.approver?.name ?? "-"}
              {transaction.approvedAt
                ? ` · ${formatDateTime(transaction.approvedAt)}`
                : ""}
            </MetaItem>
            <MetaItem label="Dibayar pada">
              {transaction.paidAt ? formatDateTime(transaction.paidAt) : "-"}
            </MetaItem>
            <MetaItem label="Dibuat">
              {formatDateTime(transaction.createdAt)}
            </MetaItem>
          </dl>

          <div className="border-t border-slate-200 pt-4">
            <h3 className="text-sm font-semibold text-slate-900">Tindakan</h3>
            {canEdit ||
            canSubmit ||
            canApprove ||
            canReject ||
            canPay ||
            canCancel ||
            canReopen ||
            canReverse ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {canEdit ? (
                  <button
                    type="button"
                    onClick={() => setEditOpen(true)}
                    className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-slate-500 focus-visible:ring-offset-2 focus-visible:outline-none"
                  >
                    Edit
                  </button>
                ) : null}
                {canSubmit ? (
                  <button
                    type="button"
                    onClick={() => openAction("submit")}
                    className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-semibold text-white hover:bg-slate-700"
                  >
                    Ajukan
                  </button>
                ) : null}
                {canApprove ? (
                  <button
                    type="button"
                    onClick={() => openAction("approve")}
                    className="rounded-md bg-emerald-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-600"
                  >
                    Setujui
                  </button>
                ) : null}
                {canPay ? (
                  <button
                    type="button"
                    onClick={() => openAction("pay")}
                    className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-semibold text-white hover:bg-slate-700"
                  >
                    Catat pembayaran
                  </button>
                ) : null}
                {canReopen ? (
                  <button
                    type="button"
                    onClick={() => openAction("reopen")}
                    className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100"
                  >
                    Buka kembali
                  </button>
                ) : null}
                {canReject ? (
                  <button
                    type="button"
                    onClick={() => openAction("reject")}
                    className="rounded-md border border-red-300 bg-white px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50"
                  >
                    Tolak
                  </button>
                ) : null}
                {canCancel ? (
                  <button
                    type="button"
                    onClick={() => openAction("cancel")}
                    className="rounded-md border border-red-300 bg-white px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50"
                  >
                    Batalkan
                  </button>
                ) : null}
                {canReverse ? (
                  <button
                    type="button"
                    onClick={() => openAction("reverse")}
                    className="rounded-md border border-red-300 bg-white px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50"
                  >
                    Reversal
                  </button>
                ) : null}
              </div>
            ) : (
              <p className="mt-2 text-sm text-slate-500">
                Tidak ada tindakan yang tersedia untuk status ini.
              </p>
            )}
          </div>

          <section aria-label="Riwayat status transaksi">
            <h3 className="text-sm font-semibold text-slate-900">
              Riwayat status
            </h3>
            {transaction.history.length === 0 ? (
              <p className="mt-2 text-sm text-slate-500">
                Belum ada riwayat status.
              </p>
            ) : (
              <ol className="mt-3 space-y-4">
                {transaction.history.map((entry) => (
                  <li
                    key={entry.id}
                    className="relative border-l border-slate-200 pl-4"
                  >
                    <span
                      aria-hidden="true"
                      className="absolute top-1.5 -left-1 h-2 w-2 rounded-full bg-slate-400"
                    />
                    <p className="text-sm font-medium text-slate-900">
                      {historyTransition(entry.fromStatus, entry.toStatus)}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {entry.changedBy.name} · {formatDateTime(entry.createdAt)}
                    </p>
                    {entry.note ? (
                      <p className="mt-1 text-sm break-words text-slate-600">
                        {entry.note}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ol>
            )}
          </section>

          <section aria-label="Bukti transaksi" className="border-t border-slate-200 pt-4">
            <h3 className="text-sm font-semibold text-slate-900">Bukti transaksi</h3>
            <p className="mt-1 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">Sebelum mengunggah, sensor atau tutupi NIK, PIN, nomor rekening, nomor telepon, dan tanda tangan yang tidak diperlukan.</p>
            <label className="mt-3 block text-sm font-medium text-slate-700" htmlFor="evidence-file">Unggah bukti (JPEG, PNG, PDF, atau WebP; maks. 10 MB)</label>
            <input id="evidence-file" type="file" accept="image/jpeg,image/png,application/pdf,image/webp" disabled={uploadMutation.isPending} onChange={(event) => { const file = event.target.files?.[0]; setFileError(null); if (!file) return; if (!["image/jpeg", "image/png", "application/pdf", "image/webp"].includes(file.type) || file.size > 10 * 1024 * 1024) { setFileError("Pilih JPEG, PNG, PDF, atau WebP dengan ukuran maksimal 10 MB."); event.target.value = ""; return; } uploadMutation.mutate(file, { onError: (error) => setFileError(toFriendlyFinanceError(error)) }); event.target.value = ""; }} className="mt-1 block w-full text-sm text-slate-700 file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-2" />
            {uploadMutation.isPending ? <p role="status" className="mt-2 text-sm text-slate-600">Mengunggah bukti…</p> : null}
            {fileError ? <p role="alert" className="mt-2 text-sm text-red-700">{fileError}</p> : null}
            {evidenceQuery.isLoading ? <p role="status" className="mt-3 text-sm text-slate-500">Memuat bukti…</p> : evidenceQuery.error ? <ErrorState error={evidenceQuery.error} onRetry={() => evidenceQuery.refetch()} /> : evidenceQuery.data?.items.length ? <ul className="mt-3 divide-y divide-slate-100 rounded-md border border-slate-200">{evidenceQuery.data.items.map((item) => <li key={item.id} className="flex flex-wrap items-center gap-3 p-3 text-sm"><div className="min-w-0 flex-1"><p className="break-all font-medium text-slate-900">{item.originalName}</p><p className="text-xs text-slate-500">{item.mimeType} · {(item.sizeBytes / 1024 / 1024).toFixed(2)} MB · {item.uploadedBy.name} · {formatDateTime(item.createdAt)}</p>{item.sensitive ? <p className="mt-1 font-medium text-amber-800">Sensitif — pratinjau dinonaktifkan; unduh hanya setelah mempertimbangkan peringatan privasi.</p> : null}</div><button type="button" disabled={Boolean(evidenceError)} onClick={async () => { setEvidenceError(null); try { const result = await financeService.getEvidenceUrl(eventId, transactionId, item.id); if (item.sensitive && !window.confirm("Bukti ini ditandai sensitif dan dapat memuat data pribadi. Lanjutkan mengunduh?")) return; const link = document.createElement("a"); link.href = result.url; link.download = item.originalName; link.rel = "noopener noreferrer"; link.target = "_blank"; link.click(); } catch (error) { setEvidenceError(toFriendlyFinanceError(error)); } }} className="rounded-md border border-slate-300 px-3 py-1.5 font-medium hover:bg-slate-50">Unduh</button>{actor.role === "EVENT_CHAIR" ? <button type="button" disabled={sensitiveMutation.isPending} onClick={() => sensitiveMutation.mutate({id: item.id, sensitive: !item.sensitive})} className="rounded-md border border-slate-300 px-3 py-1.5 font-medium hover:bg-slate-50">{item.sensitive ? "Hapus tanda sensitif" : "Tandai sensitif"}</button> : null}</li>)}</ul> : <p className="mt-3 text-sm text-slate-500">Belum ada bukti transaksi.</p>}
            {evidenceError ? <p role="alert" className="mt-2 text-sm text-red-700">{evidenceError}</p> : null}
            {sensitiveMutation.error ? <p role="alert" className="mt-2 text-sm text-red-700">{toFriendlyFinanceError(sensitiveMutation.error)}</p> : null}
          </section>

          {actor.role === "EVENT_CHAIR" ? <section aria-label="Audit transaksi" className="border-t border-slate-200 pt-4"><h3 className="text-sm font-semibold text-slate-900">Log audit (khusus Ketua Event)</h3>{auditQuery.isLoading ? <p role="status" className="mt-2 text-sm text-slate-500">Memuat log audit…</p> : auditQuery.error ? <ErrorState error={auditQuery.error} onRetry={() => auditQuery.refetch()} /> : auditQuery.data?.items.length ? <ol className="mt-3 space-y-3">{auditQuery.data.items.map((entry) => <li key={entry.id} className="border-l border-slate-200 pl-3"><p className="text-sm font-medium text-slate-900">{entry.action}</p><p className="text-xs text-slate-500">{entry.entityType} · {entry.actorId} · {formatDateTime(entry.createdAt)}</p></li>)}</ol> : <p className="mt-2 text-sm text-slate-500">Belum ada log audit untuk transaksi ini.</p>}</section> : null}

          <section aria-label="Ledger transaksi">
            <h3 className="text-sm font-semibold text-slate-900">Ledger</h3>
            <p className="mt-1 text-xs text-slate-500">
              Ledger tidak berubah setelah diposting; koreksi transaksi PAID
              hanya melalui reversal.
            </p>
            {transaction.ledger.length === 0 ? (
              <p className="mt-2 text-sm text-slate-500">
                Belum ada entri ledger. Ledger terbentuk saat pembayaran dicatat.
              </p>
            ) : (
              <LedgerList entries={transaction.ledger} />
            )}
          </section>

          <div className="border-t border-slate-200 pt-4 sm:hidden">
            <button
              type="button"
              onClick={onClose}
              className="w-full rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
            >
              ← Kembali ke daftar
            </button>
          </div>
        </div>
      ) : detailQuery.error ? (
        detailQuery.error instanceof ApiError &&
        detailQuery.error.status === 404 ? (
          <div className="p-5">
            <ErrorState
              title="Transaksi tidak ditemukan"
              error="Transaksi tidak tersedia pada event ini atau sudah dihapus."
            />
          </div>
        ) : detailQuery.error instanceof ApiError &&
          detailQuery.error.status === 403 ? (
          <div className="p-5">
            <ErrorState
              title="Tidak punya akses ke transaksi ini"
              error="Anda bukan anggota aktif event ini."
            />
          </div>
        ) : (
          <div className="p-5">
            <ErrorState
              error={detailQuery.error}
              onRetry={() => detailQuery.refetch()}
            />
          </div>
        )
      ) : null}

      <Dialog
        title={action ? ACTION_TITLE[action] : "Konfirmasi"}
        description={
          action && transaction
            ? actionDescription(action, transaction)
            : undefined
        }
        open={action !== null}
        onClose={closeAction}
      >
        {submitError ? (
          <div
            role="alert"
            className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
          >
            {toFriendlyFinanceError(submitError)}
          </div>
        ) : null}

        {requiresReason ? (
          <div className="mb-3">
            <label
              htmlFor="transaction-action-reason"
              className="block text-sm font-medium text-slate-700"
            >
              Alasan (wajib, minimal 3 karakter)
            </label>
            <textarea
              id="transaction-action-reason"
              rows={3}
              value={formValue}
              onChange={(event) => setFormValue(event.target.value)}
              disabled={pending}
              aria-invalid={Boolean(formError)}
              className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-500 focus:ring-1 focus:ring-slate-500 focus:outline-none disabled:opacity-60"
            />
          </div>
        ) : null}

        {hasOptionalText ? (
          <div className="mb-3">
            <label
              htmlFor="transaction-action-note"
              className="block text-sm font-medium text-slate-700"
            >
              {action === "pay" ? "Catatan pembayaran (opsional)" : "Alasan (opsional)"}
            </label>
            <textarea
              id="transaction-action-note"
              rows={3}
              value={formValue}
              onChange={(event) => setFormValue(event.target.value)}
              disabled={pending}
              className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-500 focus:ring-1 focus:ring-slate-500 focus:outline-none disabled:opacity-60"
            />
          </div>
        ) : null}

        {formError ? (
          <p role="alert" className="mb-3 text-sm text-red-700">
            {formError}
          </p>
        ) : null}

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={closeAction}
            disabled={pending}
            className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-60"
          >
            Batal
          </button>
          <button
            type="button"
            onClick={() => void runAction()}
            disabled={pending}
            className={`rounded-md px-4 py-2 text-sm font-semibold text-white disabled:opacity-60 ${
              action === "approve"
                ? "bg-emerald-700 hover:bg-emerald-600"
                : action === "reject" ||
                    action === "cancel" ||
                    action === "reverse"
                  ? "bg-red-700 hover:bg-red-600"
                  : "bg-slate-900 hover:bg-slate-700"
            }`}
          >
            {pending
              ? "Memproses."
              : action
                ? ACTION_CONFIRM_LABEL[action]
                : "Lanjutkan"}
          </button>
        </div>
      </Dialog>

      {transaction ? (
        <TransactionFormDialog
          eventId={eventId}
          mode="edit"
          open={editOpen}
          initial={transaction}
          onClose={() => setEditOpen(false)}
          onSaved={() => {
            setNotice("Perubahan transaksi disimpan.");
          }}
        />
      ) : null}
    </section>
  );
}

function MetaItem({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div>
      <dt className="text-xs font-semibold tracking-widest text-slate-500 uppercase">
        {label}
      </dt>
      <dd className="mt-1 text-sm text-slate-900">{children}</dd>
    </div>
  );
}

function historyTransition(
  fromStatus: TransactionStatus | null,
  toStatus: TransactionStatus,
): string {
  const next = TRANSACTION_STATUS_LABEL[toStatus];
  if (!fromStatus) return `Dibuat sebagai ${next}`;
  return `${TRANSACTION_STATUS_LABEL[fromStatus]} → ${next}`;
}

function LedgerList({ entries }: { entries: TransactionLedgerEntry[] }) {
  const reversedEntryIds = new Set<string>();
  for (const entry of entries) {
    if (entry.reversalOfId) reversedEntryIds.add(entry.reversalOfId);
  }

  return (
    <ul className="mt-3 divide-y divide-slate-100 rounded-md border border-slate-200">
      {entries.map((entry) => {
        const isCredit = entry.direction === "CREDIT";
        const isReversal = entry.reversalOfId !== null;
        const isReversed = reversedEntryIds.has(entry.id);
        return (
          <li key={entry.id} className="p-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                  isCredit
                    ? "bg-emerald-100 text-emerald-800"
                    : "bg-red-100 text-red-800"
                }`}
              >
                {isCredit ? "Kredit (masuk)" : "Debit (keluar)"}
              </span>
              {isReversal ? (
                <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                  Reversal
                </span>
              ) : null}
              {isReversed ? (
                <span className="inline-flex items-center rounded-full bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-600">
                  Direversi
                </span>
              ) : null}
              <span className="text-xs text-slate-500">
                {entry.postedBy.name} · {formatDateTime(entry.postedAt)}
              </span>
              <span
                className={`ml-auto font-semibold break-all tabular-nums ${
                  isCredit ? "text-emerald-700" : "text-red-700"
                }`}
              >
                {isCredit ? "+" : "-"}
                {formatCurrency(entry.amount)}
              </span>
            </div>
            {entry.narration ? (
              <p className="mt-1 break-words text-slate-600">
                {entry.narration}
              </p>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function actionDescription(
  action: ActionKind,
  transaction: TransactionDetail,
): string {
  const amount = formatCurrency(transaction.amount);
  switch (action) {
    case "submit":
      return `Transaksi "${transaction.description}" (${amount}) akan diajukan ke Ketua Event untuk disetujui.`;
    case "approve":
      return `Setujui transaksi "${transaction.description}" (${amount})? Saldo belum berubah sampai pembayaran dicatat.`;
    case "reject":
      return `Tolak transaksi "${transaction.description}" (${amount})? Pengaju dapat membuka kembali dan merevisi setelah alasan dicatat.`;
    case "reopen":
      return `Buka kembali transaksi "${transaction.description}" menjadi draf agar dapat direvisi?`;
    case "pay":
      return `Catat pembayaran "${transaction.description}" (${amount})? Ledger akan diposting dan saldo berubah.`;
    case "cancel":
      return `Batalkan transaksi "${transaction.description}" (${amount})? Tindakan ini tidak dapat dibatalkan.`;
    case "reverse":
      return `Catat reversal untuk "${transaction.description}" (${amount})? Entri ledger berlawanan akan dibuat; data asli tidak diubah.`;
  }
}
