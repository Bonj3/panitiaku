import { useState } from "react";
import { useNavigate } from "react-router";
import { toFriendlyMessage } from "@/components/shared/ErrorState";
import { useAuth } from "@/features/auth/use-auth";

/**
 * Header aplikasi sederhana untuk halaman terproteksi.
 * Menampilkan nama aplikasi + pengguna yang login + tombol Keluar.
 * Dipasang di atas konten halaman (bukan bagian dari router guard).
 */
export function AppHeader() {
  const { user, logout, isLoggingOut } = useAuth();
  const navigate = useNavigate();
  const [logoutError, setLogoutError] = useState<string | null>(null);

  const handleLogout = async () => {
    setLogoutError(null);
    try {
      await logout();
      void navigate("/auth/login", { replace: true });
    } catch (err) {
      setLogoutError(toFriendlyMessage(err));
    }
  };

  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-4xl items-center justify-between gap-4 px-6 py-3">
        <p className="text-xs font-semibold tracking-widest text-slate-500 uppercase">
          Web Panitia
        </p>
        <div className="flex items-center gap-3">
          <p className="hidden text-sm text-slate-600 sm:block">
            {user?.name ?? user?.email ?? ""}
          </p>
          <button
            type="button"
            onClick={handleLogout}
            disabled={isLoggingOut}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isLoggingOut ? "Keluar…" : "Keluar"}
          </button>
        </div>
      </div>
      {logoutError ? (
        <div
          role="alert"
          className="mx-auto max-w-4xl px-6 pb-3 text-sm text-red-700"
        >
          {logoutError}
        </div>
      ) : null}
    </header>
  );
}
