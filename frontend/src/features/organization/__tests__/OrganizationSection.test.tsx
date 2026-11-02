import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, fireEvent, cleanup } from '@testing-library/react';
import { ApiError } from '@/lib/api-client';
import { OrganizationSection } from '../OrganizationSection';
import {
  useOrganization,
  useMember,
  useMembers,
} from '../use-organization';
import { renderWithProviders } from '@/test-utils';

vi.mock('../use-organization', async (importOriginal) => {
  const actual = await importOriginal() as any;
  return {
    ...actual,
    useOrganization: vi.fn(),
    useMember: vi.fn(),
    useMembers: vi.fn(),
  };
});

const mockedUseOrganization = useOrganization as any;
const mockedUseMember = useMember as any;
const mockedUseMembers = useMembers as any;

const apiError = (status: number, message: string) =>
  new ApiError({ code: 'ERR', message }, status);

const tree = {
  root: 'm-1',
  nodes: [
    { id: 'm-1', name: 'Ani', role: 'EVENT_CHAIR' as const, status: 'ACTIVE' as const, title: null, parentId: null, depth: 0 },
    { id: 'm-2', name: 'Budi', role: 'MEMBER' as const, status: 'ACTIVE' as const, title: 'Staff', parentId: 'm-1', depth: 1 },
  ],
  edges: [
    { id: 'e-1', source: 'm-1', target: 'm-2' },
  ],
};

const memberDetail = {
  member: { id: 'm-1', userId: 'u-1', name: 'Ani', role: 'EVENT_CHAIR', status: 'ACTIVE', title: null, parentId: null },
  parent: null,
  children: [{ id: 'm-2', name: 'Budi', role: 'MEMBER', status: 'ACTIVE' }],
};

function renderSection(
  orgQuery: any,
  authRole = 'EVENT_CHAIR',
  actorMemberId = 'm-1',
  members: any = { items: [], meta: { page: 1, perPage: 10, total: 0, totalPages: 0 } },
) {
  mockedUseOrganization.mockReturnValue(orgQuery);
  mockedUseMember.mockReturnValue({
    data: memberDetail,
    isLoading: false,
    error: undefined,
    refetch: vi.fn(),
  });
  mockedUseMembers.mockReturnValue({
    data: members,
    isLoading: false,
    error: undefined,
    refetch: vi.fn(),
  });
  return renderWithProviders(
    <OrganizationSection eventId="evt-1" actorRole={authRole} actorMemberId={actorMemberId} />,
  );
}

describe('OrganizationSection — structure states (T15)', () => {
  afterEach(() => cleanup());

  it('render loading state while tree query is loading', () => {
    renderSection({ isLoading: true, error: undefined, data: undefined, refetch: vi.fn() });
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByText(/Memuat struktur organisasi/)).toBeInTheDocument();
  });

  it('render 403 access error without retry', () => {
    renderSection({
      isLoading: false,
      error: apiError(403, 'forbidden'),
      data: undefined,
      refetch: vi.fn(),
    });
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText(/Tidak punya akses ke struktur organisasi/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Coba lagi/ })).not.toBeInTheDocument();
  });

  it('render 404 empty state when event has no structure', () => {
    renderSection({
      isLoading: false,
      error: apiError(404, 'not found'),
      data: undefined,
      refetch: vi.fn(),
    });
    expect(screen.getByText(/Struktur belum tersedia/)).toBeInTheDocument();
  });

  it('render empty state when tree has no nodes', () => {
    renderSection({
      isLoading: false,
      error: undefined,
      data: { root: '', nodes: [], edges: [] },
      refetch: vi.fn(),
    });
    expect(screen.getByText(/Struktur belum tersedia/)).toBeInTheDocument();
  });

  it('render generic error state with retry button', () => {
    const refetch = vi.fn();
    renderSection({
      isLoading: false,
      error: new Error('gagal memuat struktur'),
      data: undefined,
      refetch,
    });
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText(/Gagal memuat data/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Coba lagi/ }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('render chart tab with tree nodes and member detail panel', () => {
    renderSection({
      isLoading: false,
      error: undefined,
      data: tree,
      refetch: vi.fn(),
    });
    expect(screen.getByRole('tab', { name: /Struktur Organisasi/ })).toHaveAttribute('aria-selected', 'true');
    // Root node rendered in chart + detail panel shows member name.
    expect(screen.getAllByText('Ani')).toHaveLength(2);
  });

  it('render members tab with member table when switched', () => {
    renderSection({
      isLoading: false,
      error: undefined,
      data: tree,
      refetch: vi.fn(),
    }, 'EVENT_CHAIR', 'm-1', {
      items: [{ id: 'm-2', userId: 'u-2', name: 'Budi', role: 'MEMBER', status: 'ACTIVE', title: 'Staff', parentId: 'm-1' }],
      meta: { page: 1, perPage: 10, total: 1, totalPages: 1 },
    });
    fireEvent.click(screen.getByRole('tab', { name: /Anggota/ }));
    expect(screen.getByText('Budi')).toBeInTheDocument();
    expect(screen.getByText(/Staff/)).toBeInTheDocument();
  });
});
