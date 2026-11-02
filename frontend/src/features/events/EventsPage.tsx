import { Link } from "react-router";
import { EmptyState } from "@/components/shared/EmptyState";
import { LoadingState } from "@/components/shared/LoadingState";
import { PageHeader } from "@/components/shared/PageHeader";
import { AppHeader } from "@/app/AppHeader";
import { ErrorState } from "@/components/shared/ErrorState";
import { useAuth } from "@/features/auth/use-auth";
import type { EventRole, EventStatus } from "./event.types";

const ROLE_LABEL: Record<string, string> = {
  EVENT_CHAIR: "Ketua Event",
  DIVISION_LEADER: "Ketua Divisi",
  MEMBER: "Anggota",
};

function roleLabel(role: string): string {
  return ROLE_LABEL[role] ?? role;
}

function roleBadgeClass(role: string): string {
  switch (role as EventRole) {
    case "EVENT_CHAIR":
      return "bg-slate-900 text-white";
    case "DIVISION_LEADER":
      return "bg-slate-200 text-slate-800";
    default:
      return "bg-slate-100 text-slate-600";
  }
}

function statusBadgeClass(status: string): string {
  return (status as EventStatus) === "OPEN"
    ? "bg-emerald-100 text-emerald-800"
    : "bg-slate-200 text-slate-600";
}

/**
 * Daftar event (route "/"). Sumber data: `memberships` dari useAuth()
 * (GET /auth/me) — backend tidak menyediakan endpoint list event (§13).
 */
export function EventsPage() {
  const { user, memberships, isLoading, error, refetch } = useAuth();
  // Hanya membership ACTIVE yang boleh membuka halaman event (backend tetap
  // menolak 403 untuk INACTIVE). INACTIVE ditampilkan sebagai catatan, bukan tautan.
  const activeMemberships = memberships.filter((m) => m.status === "ACTIVE");
  const inactiveCount = memberships.length - activeMemberships.length;

  return (
    <>
      <AppHeader />
      <main className="mx-auto max-w-4xl px-6 py-12">
        <PageHeader
          title={`Halo, ${user?.name ?? "Panitia"}`}
          description="Pilih event untuk dikelola, atau buat event baru."
          actions={
            activeMemberships.length > 0 ? (
              <Link
                to="/events/new"
                className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700"
              >
                Buat event
              </Link>
            ) : undefined
          }
        />

        <div className="mt-8">
          {isLoading ? (
            <LoadingState label="Memuat daftar event…" />
          ) : error ? (
            <ErrorState
              title="Gagal memuat daftar event"
              error={error}
              onRetry={() => void refetch()}
            />
          ) : activeMemberships.length === 0 ? (
            <EmptyState
              title={inactiveCount > 0 ? "Tidak ada keanggotaan aktif" : "Belum ada event"}
              description={
                inactiveCount > 0
                  ? "Keanggotaan Anda pada event yang ada sudah nonaktif. Hubungi Ketua Event bila perlu diaktifkan kembali."
                  : "Anda belum tergabung dalam event apa pun. Buat event pertama Anda untuk mulai mengelola kepanitiaan."
              }
              action={
                <Link
                  to="/events/new"
                  className="inline-block rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700"
                >
                  Buat event pertama
                </Link>
              }
            />
          ) : (
            <ul className="grid gap-4 sm:grid-cols-2">
              {activeMemberships.map((m) => (
                <li key={m.id}>
                  <Link
                    to={`/events/${m.eventId}`}
                    className="block rounded-lg border border-slate-200 bg-white p-5 shadow-sm transition hover:border-slate-400 hover:shadow"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${roleBadgeClass(m.role)}`}
                      >
                        {roleLabel(m.role)}
                      </span>
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${statusBadgeClass(m.event.status)}`}
                      >
                        {m.event.status === "OPEN" ? "Berjalan" : "Ditutup"}
                      </span>
                    </div>
                    <p className="mt-3 text-lg font-semibold text-slate-900">
                      {m.event.name}
                    </p>
                    <p className="mt-0.5 text-sm text-slate-500">
                      /{m.event.slug}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {inactiveCount > 0 ? (
            <p className="mt-4 text-sm text-slate-500">
              {inactiveCount} keanggotaan nonaktif tidak ditampilkan.
            </p>
          ) : null}
        </div>
      </main>
    </>
  );
}
