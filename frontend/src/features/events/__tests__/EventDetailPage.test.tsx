import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, fireEvent, cleanup } from '@testing-library/react';
import { ApiError } from '@/lib/api-client';
import { EventDetailPage } from '../EventDetailPage';
import { useEvent, useCloseEvent } from '../use-events';
import { useOrganization } from '../../organization/use-organization';
import { useInvitations } from '../../invitations/use-invitations';
import { useFinanceSummary } from '../../finance/use-finance';
import { useAuth } from '../../auth/use-auth';
import { renderWithProviders } from '@/test-utils';

vi.mock('../../auth/use-auth', () => ({
  useAuth: vi.fn(),
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('../use-events', async (importOriginal) => {
  const actual = await importOriginal() as any;
  return { ...actual, useEvent: vi.fn(), useCloseEvent: vi.fn() };
});
vi.mock('../../organization/use-organization', async (importOriginal) => {
  const actual = await importOriginal() as any;
  return { ...actual, useOrganization: vi.fn() };
});
vi.mock('../../invitations/use-invitations', async (importOriginal) => {
  const actual = await importOriginal() as any;
  return { ...actual, useInvitations: vi.fn() };
});
vi.mock('../../finance/use-finance', async (importOriginal) => {
  const actual = await importOriginal() as any;
  return { ...actual, useFinanceSummary: vi.fn() };
});

const mockedUseEvent = useEvent as any;
const mockedUseOrganization = useOrganization as any;
const mockedUseInvitations = useInvitations as any;
const mockedUseFinanceSummary = useFinanceSummary as any;
const mockedUseCloseEvent = useCloseEvent as any;
const mockedUseAuth = useAuth as any;

const defaultAuth = {
  user: { id: 'u-1', name: 'Panitia User', email: 'user@example.com' },
  memberships: [],
  isLoading: false,
  isAuthenticated: true,
  error: null,
  login: vi.fn(),
  isLoggingIn: false,
  loginError: null,
  logout: vi.fn(),
  isLoggingOut: false,
};

const apiError = (status: number, message: string) =>
  new ApiError({ code: 'ERR', message }, status);

function renderPage(eventQuery: any, auth: any = {}) {
  mockedUseEvent.mockReturnValue(eventQuery);
  mockedUseCloseEvent.mockReturnValue({ mutateAsync: vi.fn().mockResolvedValue({}), isPending: false });
  mockedUseOrganization.mockReturnValue({
    data: { root: 'm-1', nodes: [], edges: [] },
    isLoading: false,
    error: undefined,
    refetch: vi.fn(),
  });
  mockedUseInvitations.mockReturnValue({
    data: { items: [], meta: { page: 1, perPage: 20, total: 0, totalPages: 0 } },
    isLoading: false,
    error: undefined,
    refetch: vi.fn(),
  });
  mockedUseFinanceSummary.mockReturnValue({
    data: { balance: '0.00', totalIncome: '0.00', totalExpense: '0.00', pendingCount: 0 },
    isLoading: false,
    error: undefined,
    refetch: vi.fn(),
  });
  mockedUseAuth.mockReturnValue({ ...defaultAuth, ...auth });
  return renderWithProviders(<EventDetailPage />, {
    initialEntry: '/events/evt-1',
    path: '/events/:eventId',
  });
}

describe('EventDetailPage — detail loading/access/error states (T15)', () => {
  afterEach(() => cleanup());

  it('render loading state while event query is loading', () => {
    renderPage({ isLoading: true, error: undefined, data: undefined, isFetching: false, refetch: vi.fn() });
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByText(/Memuat detail event/)).toBeInTheDocument();
  });

  it('render 403 access error without retry', () => {
    renderPage({
      isLoading: false,
      isFetching: false,
      error: apiError(403, 'forbidden'),
      data: undefined,
      refetch: vi.fn(),
    });
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText(/Tidak punya akses ke event ini/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Coba lagi/ })).not.toBeInTheDocument();
  });

  it('render 404 not found error without retry', () => {
    renderPage({
      isLoading: false,
      isFetching: false,
      error: apiError(404, 'not found'),
      data: undefined,
      refetch: vi.fn(),
    });
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText(/Event tidak ditemukan/)).toBeInTheDocument();
  });

  it('render generic error state with retry button', () => {
    const refetch = vi.fn();
    renderPage({
      isLoading: false,
      isFetching: false,
      error: new Error('jaringan putus'),
      data: undefined,
      refetch,
    });
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText(/Gagal memuat data/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Coba lagi/ }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('render event content + mounted sub-sections when data present', () => {
    renderPage({
      isLoading: false,
      isFetching: false,
      error: undefined,
      data: {
        event: { id: 'evt-1', name: 'Seminar Kampus', slug: 'seminar-kampus', status: 'OPEN' },
        membership: { id: 'm-1', eventId: 'evt-1', userId: 'u-1', role: 'EVENT_CHAIR', status: 'ACTIVE', event: { id: 'evt-1', name: 'Seminar Kampus', slug: 'seminar-kampus', status: 'OPEN' } },
      },
      refetch: vi.fn(),
    });
    expect(screen.getAllByText(/Seminar Kampus/)).toHaveLength(2);
    expect(screen.getByText(/Ketua Event/)).toBeInTheDocument();
    expect(screen.getAllByText(/Berjalan/)).toHaveLength(2);

    // Sub-sections mounted (child hooks mocked to non-loading states).
    expect(screen.getByText(/Struktur belum tersedia/)).toBeInTheDocument(); // OrganizationSection empty tree
    expect(screen.getByText(/Belum ada undangan/)).toBeInTheDocument(); // InvitationSection empty list
    expect(screen.getByText(/Keuangan/)).toBeInTheDocument(); // FinanceOverview heading
    expect(screen.getByRole('link', { name: /Buka halaman keuangan/ })).toBeInTheDocument();
  });
});
