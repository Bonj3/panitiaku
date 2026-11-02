/**
 * Tipe kontrak keuangan (PROJECT.md §5.C, §13.6), diselaraskan dengan
 * `backend/src/modules/finance/finance.types.ts`.
 *
 * Catatan amount: backend mengirim string desimal 2 angka (mis.
 * "1500000.00") dari Prisma Decimal. Jangan dikonversi ke number.
 */

export type TransactionType = "INCOME" | "EXPENSE";

export type TransactionStatus =
  | "DRAFT"
  | "SUBMITTED"
  | "APPROVED"
  | "REJECTED"
  | "PAID"
  | "CANCELLED";

export type LedgerDirection = "CREDIT" | "DEBIT";

/** Kategori tetap (whitelist backend) per tipe transaksi. */
export const TRANSACTION_CATEGORIES = {
  INCOME: ["SPONSORSHIP", "TICKETING", "DONATION", "OTHER_INCOME"],
  EXPENSE: [
    "VENUE",
    "CONSUMPTION",
    "EQUIPMENT",
    "TRANSPORT",
    "HONORARIUM",
    "PRINTING",
    "OTHER_EXPENSE",
  ],
} as const;

export type TransactionCategory =
  (typeof TRANSACTION_CATEGORIES)[keyof typeof TRANSACTION_CATEGORIES][number];

export const ALL_TRANSACTION_CATEGORIES = [
  ...TRANSACTION_CATEGORIES.INCOME,
  ...TRANSACTION_CATEGORIES.EXPENSE,
] as const;

export const TRANSACTION_STATUSES: readonly TransactionStatus[] = [
  "DRAFT",
  "SUBMITTED",
  "APPROVED",
  "REJECTED",
  "PAID",
  "CANCELLED",
];

export const TRANSACTION_TYPE_LABEL: Record<TransactionType, string> = {
  INCOME: "Pemasukan",
  EXPENSE: "Pengeluaran",
};

export const TRANSACTION_STATUS_LABEL: Record<TransactionStatus, string> = {
  DRAFT: "Draf",
  SUBMITTED: "Menunggu persetujuan",
  APPROVED: "Disetujui",
  REJECTED: "Ditolak",
  PAID: "Dibayar",
  CANCELLED: "Dibatalkan",
};

export const TRANSACTION_CATEGORY_LABEL: Record<TransactionCategory, string> = {
  SPONSORSHIP: "Sponsorship",
  TICKETING: "Tiket",
  DONATION: "Donasi",
  OTHER_INCOME: "Pemasukan lain",
  VENUE: "Tempat",
  CONSUMPTION: "Konsumsi",
  EQUIPMENT: "Peralatan",
  TRANSPORT: "Transportasi",
  HONORARIUM: "Honorarium",
  PRINTING: "Cetak",
  OTHER_EXPENSE: "Pengeluaran lain",
};

export function transactionCategoryLabel(category: string): string {
  return (
    TRANSACTION_CATEGORY_LABEL[category as TransactionCategory] ?? category
  );
}

export interface FinanceSummary {
  balance: string;
  totalIncome: string;
  totalExpense: string;
  pendingCount: number;
}

export interface TransactionPerson {
  id: string;
  name: string;
}

/** Satu baris daftar transaksi (GET .../transactions). */
export interface TransactionItem {
  id: string;
  type: TransactionType;
  category: string;
  description: string;
  amount: string;
  currency: string;
  status: TransactionStatus;
  version: number;
  submitter: TransactionPerson | null;
  approver: TransactionPerson | null;
  submittedAt: string | null;
  approvedAt: string | null;
  paidAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TransactionHistoryEntry {
  id: string;
  fromStatus: TransactionStatus | null;
  toStatus: TransactionStatus;
  changedBy: TransactionPerson;
  note: string | null;
  createdAt: string;
}

export interface TransactionLedgerEntry {
  id: string;
  direction: LedgerDirection;
  amount: string;
  postedAt: string;
  postedBy: TransactionPerson;
  reversalOfId: string | null;
  narration: string | null;
}

/** Detail transaksi (GET .../transactions/:txId). */
export interface TransactionDetail extends TransactionItem {
  eventId: string;
  rejectReason: string | null;
  history: TransactionHistoryEntry[];
  ledger: TransactionLedgerEntry[];
  evidence: EvidenceMetadata[];
}

export interface EvidenceMetadata {
  id: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  isPaymentProof: boolean;
  sensitive: boolean;
  uploadedBy: TransactionPerson;
  createdAt: string;
}

export interface AuditLogEntry {
  id: string;
  actorId: string;
  action: string;
  entityType: string;
  entityId: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface TransactionListMeta {
  page: number;
  perPage: number;
  total: number;
  totalPages: number;
}

export interface TransactionListResponse {
  items: TransactionItem[];
  meta: TransactionListMeta;
}

/** Filter + pagination untuk daftar transaksi (kosong dilewati service). */
export interface TransactionListParams {
  status?: TransactionStatus;
  type?: TransactionType;
  category?: TransactionCategory;
  q?: string;
  page?: number;
  perPage?: number;
}

export interface CreateTransactionInput {
  type: TransactionType;
  category: TransactionCategory;
  description: string;
  amount: string;
  currency?: "IDR";
}

export interface UpdateTransactionInput {
  type?: TransactionType;
  category?: TransactionCategory;
  description?: string;
  amount?: string;
}

export interface RejectTransactionInput {
  reason: string;
}

export interface PayTransactionInput {
  narration?: string | null;
}

export interface CancelTransactionInput {
  reason?: string | null;
}

export interface ReverseTransactionInput {
  reason: string;
}

export interface PayTransactionResult {
  transaction: TransactionItem;
  ledgerEntry: TransactionLedgerEntry;
}

export interface ReverseTransactionResult {
  reversalEntry: TransactionLedgerEntry;
}
