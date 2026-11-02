import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, fireEvent, cleanup } from '@testing-library/react';
import { ApiError } from '@/lib/api-client';
import { InvitationSection } from '../InvitationSection';
import {
  useInvitations,
  useRevokeInvitation,
} from '../use-invitations';
import { renderWithProviders } from '@/test-utils';

vi.mock('../use-invitations', async (importOriginal) => {
  const actual = await importOriginal() as any;
  return {
    ...actual,
    useInvitations: vi.fn(),
    useRevokeInvitation: vi.fn(),
    useCreateInvitation: vi.fn(),
    useAcceptInvitation: vi.fn(),
    usePublicInvitation: vi.fn(),
  };
});

const mockedUseInvitations = useInvitations as any;
const mockedUseRevokeInvitation = useRevokeInvitation as any;

const apiError = (status: number, message: string) =>
  new ApiError({ code: 'ERR', message }, status);

const item = {
  id: 'inv-1',
  eventId: 'evt-1',
  email: 'budi@example.com',
  role: 'MEMBER',
  status: 'PENDING',
  parentId: 'm-1',
  invitedById: 'm-1',
  acceptedById: null,
  acceptedAt: null,
  revokedAt: null,
  expiresAt: '2026-12-01T00:00:00Z',
  createdAt: '2026-11-01T00:00:00Z',
  invitedBy: { id: 'm-1', name: 'Ani', email: 'ani@example.com', role: 'EVENT_CHAIR', status: 'ACTIVE' },
};

function renderSection(listQuery: any, actorRole = 'EVENT_CHAIR') {
  mockedUseInvitations.mockReturnValue(listQuery);
  mockedUseRevokeInvitation.mockReturnValue({ mutateAsync: vi.fn().mockResolvedValue({}), isPending: false, isError: false, error: undefined, reset: vi.fn() });
  return renderWithProviders(
    <InvitationSection eventId="evt-1" actorRole={actorRole} actorMemberId="m-1" />,
  );
}

describe('InvitationSection/List — invitation states (T15)', () => {
  afterEach(() => cleanup());

  it('render nothing for MEMBER (section gated to CHAIR/LEADER)', () => {
    renderSection(
      { isLoading: false, error: undefined, data: { items: [], meta: { page: 1, perPage: 20, total: 0, totalPages: 0 } }, refetch: vi.fn() },
      'MEMBER',
    );
    expect(screen.queryByText(/Undangan/)).not.toBeInTheDocument();
    expect(screen.queryByText(/daftar undangan/)).not.toBeInTheDocument();
  });

  it('render loading state while invitations query is loading', () => {
    renderSection({ isLoading: true, error: undefined, data: undefined, refetch: vi.fn() });
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByText(/Memuat daftar undangan/)).toBeInTheDocument();
  });

  it('render 403 access error without retry', () => {
    renderSection({
      isLoading: false,
      error: apiError(403, 'forbidden'),
      data: undefined,
      refetch: vi.fn(),
    });
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText(/Tidak punya akses ke daftar undangan/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Coba lagi/ })).not.toBeInTheDocument();
  });

  it('render empty state when no invitations', () => {
    renderSection({
      isLoading: false,
      error: undefined,
      data: { items: [], meta: { page: 1, perPage: 20, total: 0, totalPages: 0 } },
      refetch: vi.fn(),
    });
    expect(screen.getByText(/Belum ada undangan/)).toBeInTheDocument();
  });

  it('render generic error state with retry button', () => {
    const refetch = vi.fn();
    renderSection({
      isLoading: false,
      error: new Error('gagal memuat undangan'),
      data: undefined,
      refetch,
    });
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText(/Gagal memuat data/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Coba lagi/ }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('render invitation table rows when items present', () => {
    renderSection({
      isLoading: false,
      error: undefined,
      data: { items: [item], meta: { page: 1, perPage: 20, total: 1, totalPages: 1 } },
      refetch: vi.fn(),
    });
    expect(screen.getByText('budi@example.com')).toBeInTheDocument();
    expect(screen.getByText(/Anggota/)).toBeInTheDocument();
    expect(screen.getAllByText(/Menunggu/)).toHaveLength(2);
    expect(screen.getByText(/Ani/)).toBeInTheDocument();
  });

  it('open revoke dialog for PENDING invitation', () => {
    renderSection({
      isLoading: false,
      error: undefined,
      data: { items: [item], meta: { page: 1, perPage: 20, total: 1, totalPages: 1 } },
      refetch: vi.fn(),
    });
    fireEvent.click(screen.getByRole('button', { name: /Cabut/ }));
    expect(screen.getByRole('dialog', { name: /Cabut undangan/ })).toBeInTheDocument();
    expect(screen.getAllByText(/budi@example.com/)).toHaveLength(2);
  });
});
