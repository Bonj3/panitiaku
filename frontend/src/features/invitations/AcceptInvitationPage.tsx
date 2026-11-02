import { Link, useLocation, useNavigate, useParams } from "react-router";
import { useState } from "react";
import { ErrorState, toFriendlyMessage } from "@/components/shared/ErrorState";
import { LoadingState } from "@/components/shared/LoadingState";
import { PageHeader } from "@/components/shared/PageHeader";
import { AppHeader } from "@/app/AppHeader";
import { useAuth } from "@/features/auth/use-auth";
import { ApiError } from "@/lib/api-client";
import { formatDateTime } from "@/lib/format";
import { INVITATION_ROLE_LABEL } from "./invitation.types";
import { useAcceptInvitation, usePublicInvitation } from "./use-invitations";

/**
 * Halaman publik terima undangan (route "/invitations/:token", di luar
 * RequireAuth — detail GET publik tanpa sesi).
 *
 * - 404 → "Undangan tidak ditemukan".
 * - 410 → "Undangan sudah tidak berlaku (kedaluwarsa/sudah dipakai/dicabut)".
 * - Belum login → tombol "Masuk untuk menerima" (state.from kembali ke sini).
 * - Sudah login → tombol "Terima undangan"; sukses → redirect
 *   `/events/:eventId`. 403/409/410 ditampilkan ramah.
 * - eventStatus CLOSED → peringatan + tombol terima dinonaktifkan.
 */
export function AcceptInvitationPage() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const detailQuery = usePublicInvitation(token);
  const acceptMutation = useAcceptInvitation();
  const [acceptError, setAcceptError] = useState<unknown>(null);

  const handleAccept = async () => {
    if (!token) return;
    setAcceptError(null);
    try {
      const result = await acceptMutation.mutateAsync({ token });
      void navigate(`/events/${result.membership.eventId}`, {
        replace: true,
      });
    } catch (err) {
      setAcceptError(err);
    }
  };

  return (
    <>
      {isAuthenticated ? <AppHeader /> : null}
      <main className="mx-auto max-w-2xl px-6 py-12">
        <PageHeader
          title="Undangan kepanitiaan"
          description="Periksa detail undangan sebelum menerima."
        />

        <div className="mt-6">
          {authLoading || detailQuery.isLoading ? (
            <LoadingState label="Memuat detail undangan…" />
          ) : detailQuery.error ? (
            detailQuery.error instanceof ApiError &&
            detailQuery.error.status === 410 ? (
              <div
                role="alert"
                className="flex flex-col items-center justify-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-6 py-12 text-center"
              >
                <p className="text-sm font-semibold text-amber-900">
                  Undangan sudah tidak berlaku
                </p>
                <p className="max-w-sm text-sm text-amber-800">
                  Undangan ini sudah kedaluwarsa, sudah dipakai, atau sudah
                  dicabut. Minta undangan baru kepada pengundang.
                </p>
              </div>
            ) : detailQuery.error instanceof ApiError &&
              detailQuery.error.status === 404 ? (
              <div
                role="alert"
                className="flex flex-col items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-6 py-12 text-center"
              >
                <p className="text-sm font-semibold text-slate-900">
                  Undangan tidak ditemukan
                </p>
                <p className="max-w-sm text-sm text-slate-600">
                  Link undangan tidak valid atau sudah dihapus. Periksa kembali
                  link yang Anda terima.
                </p>
              </div>
            ) : (
              <ErrorState
                error={detailQuery.error}
                onRetry={() => detailQuery.refetch()}
              />
            )
          ) : detailQuery.data ? (
            <AcceptCard
              eventName={detailQuery.data.eventName}
              eventSlug={detailQuery.data.eventSlug}
              eventStatus={detailQuery.data.eventStatus}
              role={detailQuery.data.role}
              expiresAt={detailQuery.data.expiresAt}
              isAuthenticated={isAuthenticated}
              loginPath={location.pathname}
              isAccepting={acceptMutation.isPending}
              acceptError={acceptError}
              onAccept={() => void handleAccept()}
            />
          ) : null}
        </div>
      </main>
    </>
  );
}

interface AcceptCardProps {
  eventName: string;
  eventSlug: string;
  eventStatus: string;
  role: keyof typeof INVITATION_ROLE_LABEL;
  expiresAt: string;
  isAuthenticated: boolean;
  loginPath: string;
  isAccepting: boolean;
  acceptError: unknown;
  onAccept: () => void;
}

function AcceptCard({
  eventName,
  eventSlug,
  eventStatus,
  role,
  expiresAt,
  isAuthenticated,
  loginPath,
  isAccepting,
  acceptError,
  onAccept,
}: AcceptCardProps) {
  const isClosed = eventStatus === "CLOSED";

  return (
    <section
      aria-label="Detail undangan"
      className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm"
    >
      <dl className="grid gap-4 sm:grid-cols-2">
        <div>
          <dt className="text-xs font-semibold tracking-widest text-slate-500 uppercase">
            Event
          </dt>
          <dd className="mt-1 text-sm font-medium text-slate-900">
            {eventName}
          </dd>
          <dd className="text-xs text-slate-500">/{eventSlug}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold tracking-widest text-slate-500 uppercase">
            Peran yang ditawarkan
          </dt>
          <dd className="mt-1 text-sm font-medium text-slate-900">
            {INVITATION_ROLE_LABEL[role] ?? role}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-semibold tracking-widest text-slate-500 uppercase">
            Berlaku hingga
          </dt>
          <dd className="mt-1 text-sm font-medium text-slate-900">
            {formatDateTime(expiresAt)}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-semibold tracking-widest text-slate-500 uppercase">
            Status event
          </dt>
          <dd className="mt-1 text-sm font-medium text-slate-900">
            {isClosed ? "Ditutup (CLOSED)" : "Berjalan (OPEN)"}
          </dd>
        </div>
      </dl>

      {isClosed ? (
        <div
          role="alert"
          className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
        >
          Event ini sudah ditutup sehingga undangan tidak dapat diterima lagi.
        </div>
      ) : null}

      {acceptError ? (
        <div
          role="alert"
          className="mt-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
        >
          {toFriendlyAcceptError(acceptError)}
        </div>
      ) : null}

      <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <Link
          to="/"
          className="rounded-md border border-slate-300 px-4 py-2 text-center text-sm font-medium text-slate-700 transition hover:bg-slate-100"
        >
          Kembali ke beranda
        </Link>
        {isAuthenticated ? (
          <button
            type="button"
            onClick={onAccept}
            disabled={isAccepting || isClosed}
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isAccepting ? "Menerima undangan…" : "Terima undangan"}
          </button>
        ) : (
          <Link
            to="/auth/login"
            state={{ from: { pathname: loginPath } }}
            className="rounded-md bg-slate-900 px-4 py-2 text-center text-sm font-semibold text-white transition hover:bg-slate-700"
          >
            Masuk untuk menerima
          </Link>
        )}
      </div>

      {!isAuthenticated ? (
        <p className="mt-4 text-xs text-slate-500">
          Setelah masuk, Anda akan kembali ke halaman ini. Pastikan Anda masuk
          dengan akun yang emailnya sama dengan email undangan.
        </p>
      ) : null}
    </section>
  );
}

/** 403/409/410 saat accept → pesan ramah berbahasa Indonesia. */
function toFriendlyAcceptError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 410) {
      return "Undangan sudah tidak berlaku (kedaluwarsa, sudah dipakai, atau sudah dicabut).";
    }
    if (error.status === 403) return error.message;
    if (error.status === 409) return error.message;
    if (error.status === 404) {
      return "Undangan tidak ditemukan. Periksa kembali link yang Anda terima.";
    }
    return error.message;
  }
  return toFriendlyMessage(error);
}
