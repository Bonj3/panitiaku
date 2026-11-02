import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, fireEvent, cleanup } from '@testing-library/react';
import { ApiError } from '@/lib/api-client';
import { AcceptInvitationPage } from '../AcceptInvitationPage';
import { usePublicInvitation, useAcceptInvitation } from '../use-invitations';
import { useAuth } from '../../auth/use-auth';
import { renderWithProviders } from '@/test-utils';

vi.mock('../../auth/use-auth', () => ({
  useAuth: vi.fn(),
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('../use-invitations', async (importOriginal) => {
  const actual = await importOriginal() as any;
  return {
    ...actual,
    usePublicInvitation: vi.fn(),
    useAcceptInvitation: vi.fn(),
  };
});

const mockedUsePublicInvitation = usePublicInvitation as any;
const mockedUseAcceptInvitation = useAcceptInvitation as any;
const mockedUseAuth = useAuth as any;

const apiError = (status: number, message: string) =>
  new ApiError({ code: 'ERR', message }, status);

const detail = {
  eventName: 'Seminar Kampus',
  eventSlug: 'seminar-kampus',
  eventStatus: 'OPEN' as const,
  role: 'MEMBER',
  expiresAt: '2026-12-01T00:00:00Z',
};

function renderPage(detailQuery: any, auth: any = {}) {
  const mutateAsync = vi.fn().mockResolvedValue({ membership: { eventId: 'evt-1' } });
  mockedUsePublicInvitation.mockReturnValue(detailQuery);
  mockedUseAcceptInvitation.mockReturnValue({ mutateAsync, isPending: false });
  mockedUseAuth.mockReturnValue({
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
    ...auth,
  });
  return { ...renderWithProviders(<AcceptInvitationPage />, { initialEntry: '/invitations/tok-123', path: '/invitations/:token' }), mutateAsync };
}

describe('AcceptInvitationPage — public invite states (T15)', () => {
  afterEach(() => cleanup());

  it('render loading state while detail + auth load', () => {
    renderPage({ isLoading: true, error: undefined, data: undefined, refetch: vi.fn() }, { isLoading: true });
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByText(/Memuat detail undangan/)).toBeInTheDocument();
  });

  it('render 410 expired/revoked invitation without retry', () => {
    renderPage({
      isLoading: false,
      error: apiError(410, 'gone'),
      data: undefined,
      refetch: vi.fn(),
    });
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText(/Undangan sudah tidak berlaku/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Coba lagi/ })).not.toBeInTheDocument();
  });

  it('render 404 not found invitation without retry', () => {
    renderPage({
      isLoading: false,
      error: apiError(404, 'not found'),
      data: undefined,
      refetch: vi.fn(),
    });
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText(/Undangan tidak ditemukan/)).toBeInTheDocument();
  });

  it('render generic error state with retry button', () => {
    const refetch = vi.fn();
    renderPage({
      isLoading: false,
      error: new Error('jaringan putus'),
      data: undefined,
      refetch,
    });
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText(/Gagal memuat data/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Coba lagi/ }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('render accept card with login link when not authenticated', () => {
    renderPage(
      { isLoading: false, error: undefined, data: detail, refetch: vi.fn() },
      { isAuthenticated: false, isLoading: false },
    );
    expect(screen.getByText(/Seminar Kampus/)).toBeInTheDocument();
    expect(screen.getByText(/Anggota/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Masuk untuk menerima/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Terima undangan/ })).not.toBeInTheDocument();
  });

  it('render accept card with accept button when authenticated', () => {
    renderPage(
      { isLoading: false, error: undefined, data: detail, refetch: vi.fn() },
      { isAuthenticated: true, isLoading: false },
    );
    expect(screen.getByRole('button', { name: /Terima undangan/ })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Masuk untuk menerima/ })).not.toBeInTheDocument();
  });

  it('disable accept button when event is CLOSED', () => {
    renderPage(
      { isLoading: false, error: undefined, data: { ...detail, eventStatus: 'CLOSED' }, refetch: vi.fn() },
      { isAuthenticated: true, isLoading: false },
    );
    expect(screen.getByText(/Ditutup \(CLOSED\)/)).toBeInTheDocument();
    expect(screen.getByText(/undangan tidak dapat diterima lagi/)).toBeInTheDocument();
    const btn = screen.getByRole('button', { name: /Terima undangan/ });
    expect(btn).toBeDisabled();
  });

  it('call accept mutation when accept button clicked', () => {
    const { mutateAsync } = renderPage(
      { isLoading: false, error: undefined, data: detail, refetch: vi.fn() },
      { isAuthenticated: true, isLoading: false },
    );
    fireEvent.click(screen.getByRole('button', { name: /Terima undangan/ }));
    expect(mutateAsync).toHaveBeenCalledTimes(1);
  });
});
