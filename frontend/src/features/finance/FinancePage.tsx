import { Link, useNavigate, useParams } from "react-router";
import { AppHeader } from "@/app/AppHeader";
import { ErrorState } from "@/components/shared/ErrorState";
import { LoadingState } from "@/components/shared/LoadingState";
import { PageHeader } from "@/components/shared/PageHeader";
import { isApiStatus, useEvent } from "@/features/events/use-events";
import { FinanceSection } from "./FinanceSection";
import { FinanceSummaryCards } from "./FinanceSummaryCards";
import { TransactionDetailPanel } from "./TransactionDetailPanel";
import { useFinanceSummary } from "./use-finance";

const ROLE_LABEL: Record<string, string> = {
  EVENT_CHAIR: "Ketua Event",
  DIVISION_LEADER: "Ketua Divisi",
  MEMBER: "Anggota",
};

/**
 * Halaman keuangan event.
 * Route: /events/:eventId/finance dan /events/:eventId/finance/:transactionId.
 * Guard: RequireAuth (di router); backend memvalidasi membership aktif.
 */
export function FinancePage() {
  const { eventId, transactionId } = useParams<{
    eventId: string;
    transactionId?: string;
  }>();
  const eventQuery = useEvent(eventId);

  return (
    <>
      <AppHeader />
      <main className="mx-auto max-w-4xl px-6 py-10">
        <nav aria-label="Navigasi" className="mb-6">
          <Link
            to={eventId ? `/events/${eventId}` : "/"}
            className="text-sm font-medium text-slate-600 underline underline-offset-4 hover:text-slate-900"
          >
            ← Kembali ke event
          </Link>
        </nav>

        {eventQuery.isLoading ? (
          <LoadingState label="Memuat data keuangan event." />
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
            <ErrorState
              error={eventQuery.error}
              onRetry={() => eventQuery.refetch()}
            />
          )
        ) : eventQuery.data ? (
          <FinancePageContent
            event={eventQuery.data.event}
            membership={eventQuery.data.membership}
            transactionId={transactionId}
          />
        ) : null}
      </main>
    </>
  );
}

interface FinancePageContentProps {
  event: { id: string; name: string; slug: string; status: string };
  membership: { id: string; role: string; status: string };
  transactionId?: string;
}

function FinancePageContent({
  event,
  membership,
  transactionId,
}: FinancePageContentProps) {
  const navigate = useNavigate();
  const summaryQuery = useFinanceSummary(event.id);
  const isOpen = event.status === "OPEN";
  const actor = { id: membership.id, role: membership.role };

  return (
    <div className="space-y-6">
      <PageHeader
        title={event.name}
        description={`Keuangan · /${event.slug}`}
        actions={
          <>
            <span className="inline-flex items-center rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">
              {ROLE_LABEL[membership.role] ?? membership.role}
            </span>
            <span
              className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ${
                isOpen
                  ? "bg-emerald-100 text-emerald-800"
                  : "bg-slate-200 text-slate-600"
              }`}
            >
              {isOpen ? "Berjalan (OPEN)" : "Ditutup (CLOSED)"}
            </span>
          </>
        }
      />

      {!isOpen ? (
        <div
          role="status"
          className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
        >
          <p className="font-semibold">Event sudah ditutup (read-only).</p>
          <p className="mt-1">
            Transaksi baru dan persetujuan dinonaktifkan. Riwayat transaksi dan
            saldo tetap dapat dilihat.
          </p>
        </div>
      ) : null}

      <FinanceSummaryCards
        summary={summaryQuery.data}
        loading={summaryQuery.isLoading}
        error={summaryQuery.error}
        onRetry={() => summaryQuery.refetch()}
      />

      {transactionId ? (
        <TransactionDetailPanel
          key={transactionId}
          eventId={event.id}
          transactionId={transactionId}
          actor={actor}
          eventStatus={event.status}
          onClose={() => navigate(`/events/${event.id}/finance`)}
        />
      ) : null}

      <FinanceSection
        eventId={event.id}
        actor={actor}
        eventStatus={event.status}
        onOpenTransaction={(id) =>
          navigate(`/events/${event.id}/finance/${id}`)
        }
      />
    </div>
  );
}
