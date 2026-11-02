import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, useMemo } from "react";
import type { ReactNode } from "react";
import { ApiError } from "@/lib/api-client";
import { queryKeys } from "@/lib/query-keys";
import { authService } from "./auth.service";
import type { AuthMembership, AuthUser, LoginInput } from "./auth.service";

interface AuthContextValue {
  user: AuthUser | null;
  memberships: AuthMembership[];
  isLoading: boolean;
  isAuthenticated: boolean;
  error: unknown;
  refetch: () => Promise<unknown>;
  login: (input: LoginInput) => Promise<{ user: AuthUser }>;
  isLoggingIn: boolean;
  loginError: unknown;
  logout: () => Promise<void>;
  isLoggingOut: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * AuthProvider: sumber kebenaran status sesi.
 * - Query `GET /auth/me` via TanStack Query (key: ['auth','me']).
 * - 401 (tanpa sesi) diperlakukan sebagai "belum login", bukan error fatal:
 *   query me selalu memakai `retry: false` + throw di dalam Provider
 *   ditahan sehingga konsumer hanya melihat `user: null`.
 * - Tidak menyimpan password/token dalam state apa pun.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();

  const meQuery = useQuery({
    queryKey: queryKeys.auth.me,
    queryFn: () => authService.me(),
    retry: false,
    staleTime: 60_000,
  });

  const loginMutation = useMutation({
    mutationFn: (input: LoginInput) => authService.login(input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.auth.me });
    },
  });

  const logoutMutation = useMutation({
    mutationFn: () => authService.logout(),
    onSettled: async () => {
      // Sesi berakhir (atau sudah berakhir di server): kosongkan cache me
      // agar UI langsung kembali ke status belum login.
      queryClient.setQueryData(queryKeys.auth.me, null);
      await queryClient.invalidateQueries({ queryKey: queryKeys.auth.me });
    },
  });

  const value = useMemo<AuthContextValue>(() => {
    const data = meQuery.data ?? null;
    const notLoggedIn =
      meQuery.error instanceof ApiError && meQuery.error.status === 401;

    return {
      user: data?.user ?? null,
      memberships: data?.memberships ?? [],
      // Hanya loading awal (bukan refetch background) agar RequireAuth
      // tidak menampilkan layar loading penuh saat invalidasi cache.
      isLoading: meQuery.isLoading,
      isAuthenticated: Boolean(data?.user),
      error: notLoggedIn ? null : (meQuery.error ?? null),
      refetch: () => meQuery.refetch(),
      login: (input: LoginInput) => loginMutation.mutateAsync(input),
      isLoggingIn: loginMutation.isPending,
      loginError: loginMutation.error,
      logout: async () => {
        await logoutMutation.mutateAsync();
      },
      isLoggingOut: logoutMutation.isPending,
    };
  }, [meQuery, loginMutation, logoutMutation]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/** Akses status sesi + aksi login/logout. Wajib dipakai di dalam AuthProvider. */
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth harus dipakai di dalam <AuthProvider>");
  }
  return ctx;
}
