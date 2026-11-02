import { Navigate, Outlet, useLocation } from "react-router";
import { LoadingState } from "@/components/shared/LoadingState";
import { useAuth } from "@/features/auth/use-auth";

/**
 * Guard route terproteksi. Saat status sesi masih dimuat tampilkan
 * LoadingState; bila belum login, redirect ke /auth/login dengan
 * `state.from` agar selesai login bisa kembali ke halaman tujuan.
 */
export function RequireAuth() {
  const { isLoading, isAuthenticated } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <main className="mx-auto flex min-h-screen max-w-2xl items-center justify-center px-6">
        <div className="w-full">
          <LoadingState label="Memeriksa sesi Anda…" />
        </div>
      </main>
    );
  }

  if (!isAuthenticated) {
    return (
      <Navigate
        to="/auth/login"
        replace
        state={{ from: { pathname: location.pathname } }}
      />
    );
  }

  return <Outlet />;
}
