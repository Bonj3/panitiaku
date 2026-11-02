import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, fireEvent, cleanup } from '@testing-library/react';
import { ApiError } from '@/lib/api-client';
import { TransactionDetailPanel } from '../TransactionDetailPanel';
import {
  useTransaction,
  useSubmitTransaction,
  useApproveTransaction,
  useRejectTransaction,
  useReopenTransaction,
  usePayTransaction,
  useCancelTransaction,
  useReverseTransaction,
} from '../use-finance';
import { renderWithProviders } from '@/test-utils';

vi.mock('../use-finance', async (importOriginal) => {
  const actual = await importOriginal() as any;
  return {
    ...actual,
    useTransaction: vi.fn(),
    useSubmitTransaction: vi.fn(),
    useApproveTransaction: vi.fn(),
    useRejectTransaction: vi.fn(),
    useReopenTransaction: vi.fn(),
    usePayTransaction: vi.fn(),
    useCancelTransaction: vi.fn(),
    useReverseTransaction: vi.fn(),
  };
});

vi.mock('../finance.service', () => ({
  financeService: {
    listEvidence: vi.fn().mockResolvedValue({
      items: [],
      meta: { page: 1, perPage: 20, total: 0, totalPages: 0 },
    }),
    listAuditLogs: vi.fn().mockResolvedValue({
      items: [],
      meta: { page: 1, perPage: 20, total: 0, totalPages: 0 },
    }),
    getEvidenceUrl: vi.fn().mockResolvedValue({ url: 'http://localhost/ev/x' }),
    uploadEvidence: vi.fn().mockResolvedValue(undefined),
    updateEvidenceSensitive: vi.fn().mockResolvedValue(undefined),
  },
}));

const mockedUseTransaction = useTransaction as any;
const mutationMocks = [
  useSubmitTransaction,
  useApproveTransaction,
  useRejectTransaction,
  useReopenTransaction,
  usePayTransaction,
  useCancelTransaction,
  useReverseTransaction,
] as any[];

const apiError = (status: number, message: string) =>
  new ApiError({ code: 'ERR', message }, status);

const transaction: any = {
  id: 'tx-1',
  eventId: 'evt-1',
  type: 'EXPENSE',
  category: 'VENUE',
  description: 'Sewa aula',
  amount: '500000.00',
  currency: 'IDR',
  status: 'DRAFT',
  version: 1,
  submitter: { id: 'm-1', name: 'Ani' },
  approver: null,
  submittedAt: null,
  approvedAt: null,
  paidAt: null,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  rejectReason: null,
  history: [],
  ledger: [],
  evidence: [],
};

const actor = { id: 'm-1', role: 'MEMBER' as const };

function mockAllMutations() {
  mutationMocks.forEach((m) =>
    m.mockReturnValue({
      mutateAsync: vi.fn().mockResolvedValue(undefined),
      isPending: false,
      isError: false,
      error: undefined,
      reset: vi.fn(),
    }),
  );
}

function renderPanel(detailQuery: any, actorRole: string = 'MEMBER') {
  mockAllMutations();
  mockedUseTransaction.mockReturnValue(detailQuery);
  return renderWithProviders(
    <TransactionDetailPanel
      eventId="evt-1"
      transactionId="tx-1"
      actor={actorRole === 'MEMBER' ? { ...actor } : { ...actor, role: actorRole }}
      eventStatus="OPEN"
      onClose={vi.fn()}
    />,
  );
}

describe('TransactionDetailPanel — detail states (T15)', () => {
  afterEach(() => cleanup());

  it('render loading state while detail query loads', () => {
    renderPanel({ isLoading: true, error: undefined, data: undefined, refetch: vi.fn() });
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByText(/Memuat detail transaksi/)).toBeInTheDocument();
  });

  it('render 404 when transaction not found (no retry)', () => {
    renderPanel({
      isLoading: false,
      error: apiError(404, 'not found'),
      data: undefined,
      refetch: vi.fn(),
    });
    expect(screen.getByText(/Transaksi tidak ditemukan/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Coba lagi/ })).not.toBeInTheDocument();
  });

  it('render 403 when no access to transaction (no retry)', () => {
    renderPanel({
      isLoading: false,
      error: apiError(403, 'forbidden'),
      data: undefined,
      refetch: vi.fn(),
    });
    expect(screen.getByText(/Tidak punya akses ke transaksi ini/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Coba lagi/ })).not.toBeInTheDocument();
  });

  it('render generic error state with retry button', () => {
    const refetch = vi.fn();
    renderPanel({
      isLoading: false,
      error: new Error('gagal memuat detail'),
      data: undefined,
      refetch,
    });
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText(/Gagal memuat data/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Coba lagi/ }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('render transaction detail + actions + empty evidence when data present', async () => {
    renderPanel({
      isLoading: false,
      error: undefined,
      data: transaction,
      refetch: vi.fn(),
    });
    expect(screen.getAllByText(/Sewa aula/)).toHaveLength(2);
    expect(screen.getByText(/Rp500\.000/)).toBeInTheDocument();
    expect(screen.getByText(/Draf/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Edit/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Ajukan/ })).toBeInTheDocument();
    expect(screen.getByText(/Belum ada entri ledger/)).toBeInTheDocument();
    // Evidence query resolves to empty list.
    expect(await screen.findByText(/Belum ada bukti/)).toBeInTheDocument();
  });

  it('render history section when transaction has history', () => {
    renderPanel({
      isLoading: false,
      error: undefined,
      data: { ...transaction, history: [{ id: 'h-1', fromStatus: null, toStatus: 'DRAFT', changedBy: { id: 'm-1', name: 'Ani' }, note: null, createdAt: '2026-01-01T00:00:00Z' }] },
      refetch: vi.fn(),
    });
    expect(screen.getByText(/Riwayat status/)).toBeInTheDocument();
    expect(screen.getByText(/Dibuat sebagai Draf/)).toBeInTheDocument();
  });
});
