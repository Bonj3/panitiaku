import { apiClient } from "@/lib/api-client";
import type {
  CancelTransactionInput,
  CreateTransactionInput,
  FinanceSummary,
  PayTransactionInput,
  PayTransactionResult,
  RejectTransactionInput,
  ReverseTransactionInput,
  ReverseTransactionResult,
  TransactionDetail,
  TransactionItem,
  TransactionListParams,
  TransactionListResponse,
  UpdateTransactionInput,
  EvidenceMetadata,
  AuditLogEntry,
} from "./finance.types";

function eventPath(eventId: string): string {
  return `/events/${encodeURIComponent(eventId)}`;
}

function transactionPath(eventId: string, transactionId: string): string {
  return `${eventPath(eventId)}/transactions/${encodeURIComponent(transactionId)}`;
}

/**
 * Bangun query string. Nilai kosong/undefined dilewati dan setiap nilai
 * di-encode dengan encodeURIComponent.
 */
function toQuery(params: TransactionListParams): string {
  const parts: string[] = [];

  const add = (key: string, value: string | number | undefined) => {
    if (value === undefined || value === null) return;
    const text = String(value).trim();
    if (!text) return;
    parts.push(`${key}=${encodeURIComponent(text)}`);
  };

  add("status", params.status);
  add("type", params.type);
  add("category", params.category);
  add("q", params.q);
  add("page", params.page);
  add("perPage", params.perPage);

  return parts.length > 0 ? `?${parts.join("&")}` : "";
}

/**
 * Lapisan service keuangan di atas api-client terpusat.
 * Satu-satunya lapisan yang boleh memanggil HTTP untuk domain finance -
 * komponen UI memakai hooks (`use-finance.ts`).
 */
export const financeService = {
  async uploadEvidence(eventId: string, transactionId: string, file: File, isPaymentProof = false): Promise<EvidenceMetadata> {
    const form = new FormData(); form.append("file", file); form.append("isPaymentProof", String(isPaymentProof));
    return apiClient.post<EvidenceMetadata>(`${transactionPath(eventId, transactionId)}/evidence`, form);
  },
  listEvidence(eventId: string, transactionId: string): Promise<{items: EvidenceMetadata[]}> {
    return apiClient.get(`${transactionPath(eventId, transactionId)}/evidence`);
  },
  getEvidenceUrl(eventId: string, transactionId: string, evidenceId: string): Promise<{url: string; expiresAt: string; evidence: EvidenceMetadata}> {
    return apiClient.get(`${transactionPath(eventId, transactionId)}/evidence/${encodeURIComponent(evidenceId)}/url`);
  },
  updateEvidenceSensitive(eventId: string, transactionId: string, evidenceId: string, sensitive: boolean): Promise<EvidenceMetadata> {
    return apiClient.patch(`${transactionPath(eventId, transactionId)}/evidence/${encodeURIComponent(evidenceId)}/sensitive`, {sensitive});
  },
  listAuditLogs(eventId: string, transactionId: string): Promise<{items: AuditLogEntry[]; meta: {page: number; totalPages: number}}> {
    return apiClient.get(`${eventPath(eventId)}/audit-logs?entityType=transaction&entityId=${encodeURIComponent(transactionId)}&page=1&perPage=50`);
  },
  /** GET /events/:eventId/finance/summary */
  getSummary(eventId: string): Promise<FinanceSummary> {
    return apiClient.get<FinanceSummary>(
      `${eventPath(eventId)}/finance/summary`,
    );
  },

  /** GET /events/:eventId/transactions?status&type&category&q&page&perPage */
  list(
    eventId: string,
    params: TransactionListParams,
  ): Promise<TransactionListResponse> {
    return apiClient.get<TransactionListResponse>(
      `${eventPath(eventId)}/transactions${toQuery(params)}`,
    );
  },

  /** GET /events/:eventId/transactions/:txId */
  getDetail(eventId: string, transactionId: string): Promise<TransactionDetail> {
    return apiClient.get<TransactionDetail>(
      transactionPath(eventId, transactionId),
    );
  },

  /** POST /events/:eventId/transactions → 201 TxItem. */
  create(
    eventId: string,
    input: CreateTransactionInput,
  ): Promise<TransactionItem> {
    return apiClient.post<TransactionItem>(
      `${eventPath(eventId)}/transactions`,
      { ...input, currency: input.currency ?? "IDR" },
    );
  },

  /** PATCH /events/:eventId/transactions/:txId → 200 TxItem (DRAFT saja). */
  update(
    eventId: string,
    transactionId: string,
    input: UpdateTransactionInput,
  ): Promise<TransactionItem> {
    return apiClient.patch<TransactionItem>(
      transactionPath(eventId, transactionId),
      input,
    );
  },

  /** POST .../submit → 200 TxItem. */
  submit(eventId: string, transactionId: string): Promise<TransactionItem> {
    return apiClient.post<TransactionItem>(
      `${transactionPath(eventId, transactionId)}/submit`,
      {},
    );
  },

  /** POST .../approve → 200 TxItem (Chair). */
  approve(eventId: string, transactionId: string): Promise<TransactionItem> {
    return apiClient.post<TransactionItem>(
      `${transactionPath(eventId, transactionId)}/approve`,
      {},
    );
  },

  /** POST .../reject { reason } → 200 TxItem (Chair). */
  reject(
    eventId: string,
    transactionId: string,
    input: RejectTransactionInput,
  ): Promise<TransactionItem> {
    return apiClient.post<TransactionItem>(
      `${transactionPath(eventId, transactionId)}/reject`,
      input,
    );
  },

  /** POST .../reopen → 200 TxItem. */
  reopen(eventId: string, transactionId: string): Promise<TransactionItem> {
    return apiClient.post<TransactionItem>(
      `${transactionPath(eventId, transactionId)}/reopen`,
      {},
    );
  },

  /** POST .../pay { narration? } → 200 { transaction, ledgerEntry }. */
  pay(
    eventId: string,
    transactionId: string,
    input: PayTransactionInput,
  ): Promise<PayTransactionResult> {
    return apiClient.post<PayTransactionResult>(
      `${transactionPath(eventId, transactionId)}/pay`,
      input,
    );
  },

  /** POST .../cancel { reason? } → 200 TxItem. */
  cancel(
    eventId: string,
    transactionId: string,
    input: CancelTransactionInput,
  ): Promise<TransactionItem> {
    return apiClient.post<TransactionItem>(
      `${transactionPath(eventId, transactionId)}/cancel`,
      input,
    );
  },

  /** POST .../reverse { reason } → 201 { reversalEntry } (Chair). */
  reverse(
    eventId: string,
    transactionId: string,
    input: ReverseTransactionInput,
  ): Promise<ReverseTransactionResult> {
    return apiClient.post<ReverseTransactionResult>(
      `${transactionPath(eventId, transactionId)}/reverse`,
      input,
    );
  },
};
