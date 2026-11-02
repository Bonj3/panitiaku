import { Prisma } from '../../generated/prisma/client.js';

export type TxType = 'INCOME' | 'EXPENSE';
export type TxStatus = 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'PAID' | 'CANCELLED';
export type LedgerDirection = 'CREDIT' | 'DEBIT';

export interface TxSummary {
  balance: string;
  totalIncome: string;
  totalExpense: string;
  pendingCount: number;
}

export interface TxItem {
  id: string;
  type: TxType;
  category: string;
  description: string;
  amount: string;
  currency: string;
  status: TxStatus;
  version: number;
  submitter: { id: string; name: string } | null;
  approver: { id: string; name: string } | null;
  submittedAt: Date | null;
  approvedAt: Date | null;
  paidAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface TxHistory {
  id: string;
  fromStatus: TxStatus | null;
  toStatus: TxStatus;
  changedBy: { id: string; name: string };
  note: string | null;
  createdAt: Date;
}

export interface TxLedgerEntry {
  id: string;
  direction: LedgerDirection;
  amount: string;
  postedAt: Date;
  postedBy: { id: string; name: string };
  reversalOfId: string | null;
  narration: string | null;
}

export interface TxDetail {
  id: string;
  eventId: string;
  type: TxType;
  category: string;
  description: string;
  amount: string;
  currency: string;
  status: TxStatus;
  version: number;
  submitter: { id: string; name: string } | null;
  approver: { id: string; name: string } | null;
  submittedAt: Date | null;
  approvedAt: Date | null;
  paidAt: Date | null;
  rejectReason: string | null;
  createdAt: Date;
  updatedAt: Date;
  history: TxHistory[];
  ledger: TxLedgerEntry[];
}

export interface CategoryWhitelist {
  [key: string]: string[];
}

export const CATEGORY_WHITELIST: CategoryWhitelist = {
  INCOME: ['SPONSORSHIP', 'TICKETING', 'DONATION', 'OTHER_INCOME'],
  EXPENSE: [
    'VENUE',
    'CONSUMPTION',
    'EQUIPMENT',
    'TRANSPORT',
    'HONORARIUM',
    'PRINTING',
    'OTHER_EXPENSE',
  ],
};

/**
 * Format uang ke string desimal 2 angka (jangan float).
 * Pakai Prisma.Decimal agar aman untuk nilai negatif/desimal dan konsisten
 * dengan kolom NUMERIC(19,2) di database.
 */
export function formatMoney(value: number | string | Prisma.Decimal): string {
  const s = value instanceof Prisma.Decimal ? value.toString() : String(value);
  return new Prisma.Decimal(s).toFixed(2);
}
