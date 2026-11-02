import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import type { ReactNode } from "react";
import { RouterProvider } from "react-router";
import { AuthProvider } from "@/features/auth/use-auth";
import { router } from "./router";

interface ProvidersProps {
  children?: ReactNode;
}

/**
 * Provider global: TanStack Query → AuthProvider → React Router.
 * AuthProvider wajib berada di dalam QueryClientProvider karena memakai
 * `useQuery`/`useMutation` untuk status sesi (`GET /auth/me`).
 * Guard per-route (RequireAuth) dipasang pada `src/app/router.tsx`.
 */
export function Providers({ children }: ProvidersProps) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            retry: 1,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        {children}
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>
  );
}
