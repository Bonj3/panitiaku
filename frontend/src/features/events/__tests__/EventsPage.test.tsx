import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, cleanup, fireEvent } from '@testing-library/react';
import { EventsPage } from '../EventsPage';
import { useAuth } from '../../auth/use-auth';
import { renderWithProviders } from '@/test-utils';

vi.mock('../../auth/use-auth', () => ({
  useAuth: vi.fn(),
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const mockedUseAuth = useAuth as any;

const defaultAuth = {
  user: { id: 'u-1', name: 'Panitia User', email: 'user@example.com' },
  memberships: [],
  isLoading: false,
  isAuthenticated: true,
  error: null,
  refetch: vi.fn(),
  login: vi.fn(),
  isLoggingIn: false,
  loginError: null,
  logout: vi.fn(),
  isLoggingOut: false,
};

function renderPage(auth: any) {
  mockedUseAuth.mockReturnValue({ ...defaultAuth, ...auth });
  return renderWithProviders(<EventsPage />);
}

describe('EventsPage — list loading/empty/error states (T15)', () => {
  afterEach(() => cleanup());

  it('render loading state while session is loading', () => {
    renderPage({ isLoading: true });
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByText(/Memuat daftar event/)).toBeInTheDocument();
  });

  it('render empty state when no active memberships', () => {
    renderPage({
      memberships: [],
    });
    expect(screen.getByText(/Belum ada event/)).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: /Buat event pertama/ }),
    ).toBeInTheDocument();
  });

  it('render empty state noting inactive memberships', () => {
    renderPage({
      memberships: [
        {
          id: 'm-1',
          eventId: 'evt-1',
          userId: 'u-1',
          role: 'MEMBER',
          status: 'INACTIVE',
          event: { id: 'evt-1', name: 'Acara Lama', slug: 'acara-lama', status: 'OPEN' },
        },
      ],
    });
    expect(screen.getByText(/Tidak ada keanggotaan aktif/)).toBeInTheDocument();
    expect(screen.getByText(/1 keanggotaan nonaktif/)).toBeInTheDocument();
  });

  it('render error state with retry when session load fails', () => {
    renderPage({
      isLoading: false,
      error: new Error('gagal memuat sesi'),
    });
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText(/Gagal memuat daftar event/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Coba lagi/ })).toBeInTheDocument();
  });

  it('render active event cards when memberships present', () => {
    renderPage({
      memberships: [
        {
          id: 'm-1',
          eventId: 'evt-1',
          userId: 'u-1',
          role: 'EVENT_CHAIR',
          status: 'ACTIVE',
          event: { id: 'evt-1', name: 'Seminar Kampus', slug: 'seminar-kampus', status: 'OPEN' },
        },
      ],
    });
    expect(screen.getByText(/Seminar Kampus/)).toBeInTheDocument();
    expect(screen.getByText(/Berjalan/)).toBeInTheDocument();
  });

  it('retries the session query when retry is clicked', () => {
    const refetch = vi.fn();
    renderPage({ isLoading: false, error: new Error('x'), refetch });
    fireEvent.click(screen.getByRole('button', { name: /Coba lagi/ }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
