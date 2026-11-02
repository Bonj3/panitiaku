import { useState } from "react";
import { Link, useParams } from "react-router";
import { ErrorState, toFriendlyMessage } from "@/components/shared/ErrorState";
import { LoadingState } from "@/components/shared/LoadingState";
import { PageHeader } from "@/components/shared/PageHeader";
import { AppHeader } from "@/app/AppHeader";
import { FinanceSummaryCards } from "@/features/finance/FinanceSummaryCards";
import { useFinanceSummary } from "@/features/finance/use-finance";
import { OrganizationSection } from "@/features/organization/OrganizationSection";
import { InvitationSection } from "@/features/invitations/InvitationSection";
import { ApiError } from "@/lib/api-client";
import { isApiStatus, useCloseEvent, useEvent } from "./use-events";

const ROLE_LABEL: Record<string, string> = {
  EVENT_CHAIR: "Ketua Event",
  DIVISION_LEADER: "Ketua Divisi",
  MEMBER: "Anggota",
};

/**
 * Detail event (route "/events/:eventId").
 * - 403 → "Tidak punya akses ke event ini" tanpa tombol retry.
 * - 404 → "Event tidak ditemukan" tanpa tombol retry.
 * - Error lain → ErrorState standar dengan retry.
 * Tombol "Tutup Event" hanya tampil untuk EVENT_CHAIR saat status OPEN,
 * memakai dialog konfirmasi inline (bukan window.confirm).
 */
export function EventDetailPage() {
  const { eventId } = useParams<{ eventId: string }>();
  const eventQuery = useEvent(eventId);
  const closeEvent = useCloseEvent(eventId ?? "");

  const [confirmingClose, setConfirmingClose] = useState(false);
  const [closeError, setCloseError] = useState<string | null>(null);

  const handleClose = async () => {
    setCloseError(null);
    try {
      await closeEvent.mutateAsync();
      setConfirmingClose(false);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setCloseError(
          "Event sudah ditutup sebelumnya. Halaman akan diperbarui.",
        );
      } else {
        setCloseError(toFriendlyMessage(err));
      }
    }
  };

  return (
    <>
      <AppHeader />
      <main className="mx-auto max-w-4xl px-6 py-12">
        <nav aria-label="Navigasi" className="mb-6">
          <Link
            to="/"
            className="text-sm font-medium text-slate-600 underline underline-offset-4 hover:text-slate-900"
          >
            ← Kembali ke daftar event
          </Link>
        </nav>

        {eventQuery.isLoading || eventQuery.isFetching ? (
          <LoadingState label="Memuat detail event…" />
        ) : eventQuery.error ? (
          isApiStatus(eventQuery.error, 403) ? (
            <ErrorState
              title="Tidak punya akses ke event ini"
              error="Anda bukan anggota aktif event ini, atau keanggotaan Anda sudah dinonaktifkan."
            />
          ) : isApiStatus(eventQuery.error, 404) ? (
            <ErrorState
              title="Event tidak ditemukan"
              error="Event yang Anda cari tidak tersedia atau sudah dihapus."
            />
          ) : (
            <ErrorState error={eventQuery.error} onRetry={() => eventQuery.refetch()} />
          )
        ) : eventQuery.data ? (
          <EventDetailContent
            event={eventQuery.data.event}
            membership={eventQuery.data.membership}
            confirmingClose={confirmingClose}
            onRequestClose={() => {
              setCloseError(null);
              setConfirmingClose(true);
            }}
            onCancelClose={() => {
              setCloseError(null);
              setConfirmingClose(false);
            }}
            onConfirmClose={handleClose}
            isClosing={closeEvent.isPending}
            closeError={closeError}
          />
        ) : null}
      </main>
    </>
  );
}

interface EventDetailContentProps {
  event: { id: string; name: string; slug: string; status: string };
  membership: { id: string; role: string; status: string };
  confirmingClose: boolean;
  onRequestClose: () => void;
  onCancelClose: () => void;
  onConfirmClose: () => void;
  isClosing: boolean;
  closeError: string | null;
}

function EventDetailContent({
  event,
  membership,
  confirmingClose,
  onRequestClose,
  onCancelClose,
  onConfirmClose,
  isClosing,
  closeError,
}: EventDetailContentProps) {
  const isOpen = event.status === "OPEN";
  const isChair = membership.role === "EVENT_CHAIR";

  return (
    <div className="space-y-6">
      <PageHeader
        title={event.name}
        description={`/${event.slug}`}
        actions={
          <span
            className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ${
              isOpen
                ? "bg-emerald-100 text-emerald-800"
                : "bg-slate-200 text-slate-600"
            }`}
          >
            {isOpen ? "Berjalan" : "Ditutup"}
          </span>
        }
      />

      <section
        aria-label="Informasi event"
        className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm"
      >
        <dl className="grid gap-4 sm:grid-cols-2">
          <div>
            <dt className="text-xs font-semibold tracking-widest text-slate-500 uppercase">
              Nama event
            </dt>
            <dd className="mt-1 text-sm font-medium text-slate-900">
              {event.name}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold tracking-widest text-slate-500 uppercase">
              Slug
            </dt>
            <dd className="mt-1 text-sm font-medium text-slate-900">
              {event.slug}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold tracking-widest text-slate-500 uppercase">
              Status
            </dt>
            <dd className="mt-1 text-sm font-medium text-slate-900">
              {isOpen ? "Berjalan (OPEN)" : "Ditutup (CLOSED)"}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold tracking-widest text-slate-500 uppercase">
              Peran Anda
            </dt>
            <dd className="mt-1 text-sm font-medium text-slate-900">
              {ROLE_LABEL[membership.role] ?? membership.role}
            </dd>
          </div>
        </dl>

        {isChair && isOpen ? (
          <div className="mt-6 border-t border-slate-200 pt-6">
            {closeError ? (
              <div
                role="alert"
                className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
              >
                {closeError}
              </div>
            ) : null}

            {confirmingClose ? (
              <div
                role="alertdialog"
                aria-label="Konfirmasi tutup event"
                className="rounded-md border border-amber-200 bg-amber-50 px-4 py-4"
              >
                <p className="text-sm font-semibold text-amber-900">
                  Tutup event ini?
                </p>
                <p className="mt-1 text-sm text-amber-800">
                  Event yang ditutup tidak dapat dibuka kembali. Pastikan
                  seluruh kegiatan sudah selesai.
                </p>
                <div className="mt-4 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                  <button
                    type="button"
                    onClick={onCancelClose}
                    disabled={isClosing}
                    className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Batal
                  </button>
                  <button
                    type="button"
                    onClick={onConfirmClose}
                    disabled={isClosing}
                    className="rounded-md bg-red-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isClosing ? "Menutup…" : "Ya, tutup event"}
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={onRequestClose}
                className="rounded-md border border-red-300 px-4 py-2 text-sm font-medium text-red-700 transition hover:bg-red-50"
              >
                Tutup Event
              </button>
            )}
          </div>
        ) : null}
      </section>

      <OrganizationSection
        eventId={event.id}
        actorRole={membership.role}
        actorMemberId={membership.id}
      />

      <InvitationSection
        eventId={event.id}
        actorRole={membership.role}
        actorMemberId={membership.id}
      />

      <FinanceOverview eventId={event.id} />
    </div>
  );
}

/** Overview ringkas keuangan di EventDetailPage (tanpa menduplikasi tabel). */
function FinanceOverview({ eventId }: { eventId: string }) {
  const summaryQuery = useFinanceSummary(eventId);

  return (
    <section
      aria-label="Keuangan"
      className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Keuangan</h2>
          <p className="mt-1 text-sm text-slate-600">
            Ringkasan saldo dan arus kas dari ledger event.
          </p>
        </div>
        <Link
          to={`/events/${eventId}/finance`}
          className="shrink-0 rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-700"
        >
          Buka halaman keuangan
        </Link>
      </div>

      <div className="mt-5">
        <FinanceSummaryCards
          compact
          summary={summaryQuery.data}
          loading={summaryQuery.isLoading}
          error={summaryQuery.error}
          onRetry={() => summaryQuery.refetch()}
        />
      </div>
    </section>
  );
}
