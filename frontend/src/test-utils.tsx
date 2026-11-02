import { render as rtlRender, type RenderOptions } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route } from 'react-router';
import type { ReactNode } from 'react';

/**
 * Render helper shared by data-page state tests.
 *
 * Wraps the UI in:
 * - QueryClientProvider (fresh client, retries disabled so 403/404 surface
 *   immediately instead of being retried silently).
 * - MemoryRouter + Routes so `useParams`/`useNavigate` used by routed pages
 *   resolve against `initialEntry`/`path`. `path` defaults to "*"; pass the
 *   route pattern (e.g. "/events/:eventId") when the page reads params.
 *
 * Auth is NOT provided here: each test file mocks `@/features/auth/use-auth`
 * (or its relative equivalent) and controls `useAuth()` via `mockReturnValue`,
 * keeping auth state explicit per scenario.
 */
export function renderWithProviders(
  ui: ReactNode,
  options: RenderOptions & { initialEntry?: string; path?: string } = {},
) {
  const { initialEntry = '/', path = '*', ...renderOptions } = options;
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false },
    },
  });

  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route path={path} element={children} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );

  return rtlRender(ui, { wrapper, ...renderOptions });
}
