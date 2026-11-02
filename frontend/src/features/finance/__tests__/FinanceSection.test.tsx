import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FinanceSection } from '../FinanceSection';
import { useTransactions } from '../use-finance';

// Mock TanStack Query hook so list states (loading/empty/error/retry) are
// driven deterministically without a backend. Other hooks fall through to the
// real module.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
vi.mock('../use-finance', async (importOriginal) => {
  const actual = await importOriginal() as any;
  return {
    ...actual,
    useTransactions: vi.fn(),
  };
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockedUseTransactions = useTransactions as any;

const eventId = 'evt-1';
const actor = { id: 'm-1', role: 'MEMBER' };
const onOpenTransaction = vi.fn();

function renderSection(state: any) {
  mockedUseTransactions.mockReturnValue(state);
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <FinanceSection
        eventId={eventId}
        actor={actor}
        eventStatus="OPEN"
        onOpenTransaction={onOpenTransaction}
      />
    </QueryClientProvider>,
  );
}

describe('FinanceSection — list loading/empty/error/retry states (T15)', () => {
  afterEach(() => cleanup());

  it('render loading state while listQuery.isLoading', () => {
    renderSection({
      isLoading: true,
      error: undefined,
      data: undefined,
      isFetching: false,
      isError: false,
      refetch: vi.fn(),
    });
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByText(/Memuat daftar transaksi/)).toBeInTheDocument();
  });

  it('render empty state when list has no items', () => {
    renderSection({
      isLoading: false,
      error: undefined,
      data: { items: [], meta: { page: 1, perPage: 10, total: 0, totalPages: 0 } },
      isFetching: false,
      isError: false,
      refetch: vi.fn(),
    });
    expect(screen.getByText(/Belum ada transaksi/)).toBeInTheDocument();
  });

  it('render error state with retry button when listQuery.error && no data', () => {
    const refetch = vi.fn();
    renderSection({
      isLoading: false,
      error: new Error('gagal memuat daftar'),
      data: undefined,
      isFetching: false,
      isError: true,
      refetch,
    });
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText(/Gagal memuat data/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Coba lagi/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Coba lagi/ }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('render transaction table when data present', () => {
    renderSection({
      isLoading: false,
      error: undefined,
      data: {
        items: [
          {
            id: 'tx-1',
            type: 'EXPENSE',
            category: 'VENUE',
            description: 'Sewa aula',
            amount: '500000.00',
            currency: 'IDR',
            status: 'PAID',
            version: 1,
            submitter: { id: 'm-1', name: 'Ani' },
            approver: null,
            submittedAt: null,
            approvedAt: null,
            paidAt: null,
            createdAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-01T00:00:00Z',
          },
        ],
        meta: { page: 1, perPage: 10, total: 1, totalPages: 1 },
      },
      isFetching: false,
      isError: false,
      refetch: vi.fn(),
    });
    expect(screen.getAllByText('Sewa aula')).toHaveLength(2); // tabel + kartu mobile
    expect(screen.getAllByText(/Rp500\.000/)).toHaveLength(2);
    expect(screen.getAllByText('Dibayar').length).toBeGreaterThanOrEqual(1);
  });
});
