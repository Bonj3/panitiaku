import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

afterEach(() => cleanup());
import { FinanceSummaryCards } from '../FinanceSummaryCards';
import type { FinanceSummary } from '../finance.types';

const summary: FinanceSummary = {
  balance: '1250000.00',
  totalIncome: '2000000.00',
  totalExpense: '750000.00',
  pendingCount: 3,
};

function renderCards(props: Parameters<typeof FinanceSummaryCards>[0]) {
  return render(<FinanceSummaryCards {...props} />);
}

describe('FinanceSummaryCards — loading/empty/error/retry states (T15)', () => {
  it('render loading state when loading && !summary', () => {
    renderCards({ loading: true });
    expect(screen.getByText('Memuat ringkasan keuangan.')).toBeInTheDocument();
  });

  it('returns null when no summary && no error (empty/idle)', () => {
    const { container } = renderCards({ loading: false, summary: undefined });
    expect(container.firstChild).toBeNull();
  });

  it('render error state with retry button when error given', () => {
    const onRetry = vi.fn();
    renderCards({ loading: false, error: new Error('gagal jaringan'), onRetry });
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText(/Gagal memuat ringkasan keuangan/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Coba lagi/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Coba lagi/ }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('render four cards with values when summary present', () => {
    renderCards({ loading: false, summary: { ...summary } });
    expect(screen.getByText('Rp1.250.000')).toBeInTheDocument();
    expect(screen.getByText('Pemasukan')).toBeInTheDocument();
    expect(screen.getByText('Rp2.000.000')).toBeInTheDocument();
    expect(screen.getByText('Pengeluaran')).toBeInTheDocument();
    expect(screen.getByText('Rp750.000')).toBeInTheDocument();
    expect(screen.getByText('Menunggu Persetujuan')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('render retry banner + cards when summary present but error also given', () => {
    renderCards({ loading: false, summary: { ...summary }, error: new Error('ringkasan lama') });
    expect(screen.getByText(/Ringkasan mungkin belum terbaru/)).toBeInTheDocument();
    expect(screen.getByText('Rp1.250.000')).toBeInTheDocument();
  });
});
