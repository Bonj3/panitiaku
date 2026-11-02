import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { ApiError } from "@/lib/api-client";
import { queryKeys } from "@/lib/query-keys";
import { financeService } from "./finance.service";
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
  TransactionCategory,
  TransactionStatus,
  TransactionType,
  UpdateTransactionInput,
} from "./finance.types";

/**
 * Hooks TanStack Query untuk domain keuangan.
 * Kunci hierarkis: ['events', eventId, 'finance', ...] dan
 * ['events', eventId, 'transactions', ...] (§7 Aturan keras #2).
 */

export interface UseTransactionsParams extends TransactionListParams {}

/**
 * Invalidasi cache keuangan setelah mutasi:
 * - summary (saldo/pending) selalu berubah,
 * - seluruh daftar transaksi (prefix),
 * - detail transaksi terkait,
 * - detail event (status/ringkasan) secara exact agar tidak ikut
 *   me-refetch organization/invitations.
 */
async function invalidateFinance(
  queryClient: QueryClient,
  eventId: string,
  transactionId?: string,
): Promise<void> {
  const tasks: Array<Promise<void>> = [
    queryClient.invalidateQueries({
      queryKey: queryKeys.events.summary(eventId),
    }),
    queryClient.invalidateQueries({
      queryKey: ["events", eventId, "transactions"],
    }),
    queryClient.invalidateQueries({
      queryKey: queryKeys.events.detail(eventId),
      exact: true,
    }),
  ];

  if (transactionId) {
    tasks.push(
      queryClient.invalidateQueries({
        queryKey: queryKeys.events.transactionDetail(eventId, transactionId),
      }),
    );
  }

  await Promise.all(tasks);
}

/**
 * Pada konflik (409) status transaksi/event berubah di server. Segarkan cache
 * agar UI tidak menampilkan aksi yang sudah tidak valid; pemanggil tetap
 * menampilkan pesan error dari backend.
 */
function refreshOnConflict(
  queryClient: QueryClient,
  eventId: string,
  transactionId?: string,
) {
  return (error: unknown) => {
    if (error instanceof ApiError && error.status === 409) {
      void invalidateFinance(queryClient, eventId, transactionId);
    }
  };
}

/** Ringkasan saldo (dari ledger) + total income/expense + pending count. */
export function useFinanceSummary(eventId: string | undefined) {
  return useQuery<FinanceSummary>({
    queryKey: eventId
      ? queryKeys.events.summary(eventId)
      : (["events", "finance", "summary", "missing"] as const),
    queryFn: () => financeService.getSummary(eventId as string),
    enabled: Boolean(eventId),
    staleTime: 30_000,
    retry: false,
  });
}

/**
 * Daftar transaksi + filter + pagination.
 * `placeholderData` mempertahankan data lama saat filter/halaman berubah
 * agar tabel tidak berkedip.
 */
export function useTransactions(
  eventId: string | undefined,
  params: UseTransactionsParams,
) {
  const normalized: {
    page: number;
    perPage: number;
    q: string;
    status: TransactionStatus | "";
    type: TransactionType | "";
    category: TransactionCategory | "";
  } = {
    page: params.page ?? 1,
    perPage: params.perPage ?? 10,
    q: params.q ?? "",
    status: params.status ?? "",
    type: params.type ?? "",
    category: params.category ?? "",
  };

  return useQuery<TransactionListResponse>({
    queryKey: eventId
      ? queryKeys.events.transactions(eventId, normalized)
      : (["events", "transactions", "missing"] as const),
    queryFn: () =>
      financeService.list(eventId as string, {
        page: normalized.page,
        perPage: normalized.perPage,
        q: normalized.q || undefined,
        status: normalized.status || undefined,
        type: normalized.type || undefined,
        category: normalized.category || undefined,
      }),
    enabled: Boolean(eventId),
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[1] === eventId ? previous : undefined,
    staleTime: 15_000,
    retry: false,
  });
}

/** Detail transaksi + history + ledger. */
export function useTransaction(
  eventId: string | undefined,
  transactionId: string | undefined,
) {
  return useQuery<TransactionDetail>({
    queryKey:
      eventId && transactionId
        ? queryKeys.events.transactionDetail(eventId, transactionId)
        : (["events", "transactions", "detail", "missing"] as const),
    queryFn: () =>
      financeService.getDetail(eventId as string, transactionId as string),
    enabled: Boolean(eventId && transactionId),
    retry: false,
    staleTime: 10_000,
  });
}

/** Buat transaksi DRAFT. */
export function useCreateTransaction(eventId: string) {
  const queryClient = useQueryClient();

  return useMutation<TransactionItem, unknown, CreateTransactionInput>({
    mutationFn: (input) => financeService.create(eventId, input),
    onSuccess: async (created) => {
      await invalidateFinance(queryClient, eventId, created.id);
    },
    onError: refreshOnConflict(queryClient, eventId),
  });
}

/** Edit transaksi DRAFT (pemilik atau Chair). */
export function useUpdateTransaction(eventId: string) {
  const queryClient = useQueryClient();

  return useMutation<
    TransactionItem,
    unknown,
    { transactionId: string; input: UpdateTransactionInput }
  >({
    mutationFn: ({ transactionId, input }) =>
      financeService.update(eventId, transactionId, input),
    onSuccess: async (_updated, variables) => {
      await invalidateFinance(queryClient, eventId, variables.transactionId);
    },
    onError: (error, variables) =>
      refreshOnConflict(queryClient, eventId, variables.transactionId)(error),
  });
}

/** Ajukan DRAFT → SUBMITTED. */
export function useSubmitTransaction(eventId: string) {
  const queryClient = useQueryClient();

  return useMutation<TransactionItem, unknown, { transactionId: string }>({
    mutationFn: ({ transactionId }) =>
      financeService.submit(eventId, transactionId),
    onSuccess: async (_updated, variables) => {
      await invalidateFinance(queryClient, eventId, variables.transactionId);
    },
    onError: (error, variables) =>
      refreshOnConflict(queryClient, eventId, variables.transactionId)(error),
  });
}

/** Setujui SUBMITTED → APPROVED (Chair). */
export function useApproveTransaction(eventId: string) {
  const queryClient = useQueryClient();

  return useMutation<TransactionItem, unknown, { transactionId: string }>({
    mutationFn: ({ transactionId }) =>
      financeService.approve(eventId, transactionId),
    onSuccess: async (_updated, variables) => {
      await invalidateFinance(queryClient, eventId, variables.transactionId);
    },
    onError: (error, variables) =>
      refreshOnConflict(queryClient, eventId, variables.transactionId)(error),
  });
}

/** Tolak SUBMITTED → REJECTED (Chair, wajib alasan). */
export function useRejectTransaction(eventId: string) {
  const queryClient = useQueryClient();

  return useMutation<
    TransactionItem,
    unknown,
    { transactionId: string } & RejectTransactionInput
  >({
    mutationFn: ({ transactionId, reason }) =>
      financeService.reject(eventId, transactionId, { reason }),
    onSuccess: async (_updated, variables) => {
      await invalidateFinance(queryClient, eventId, variables.transactionId);
    },
    onError: (error, variables) =>
      refreshOnConflict(queryClient, eventId, variables.transactionId)(error),
  });
}

/** Buka kembali REJECTED → DRAFT. */
export function useReopenTransaction(eventId: string) {
  const queryClient = useQueryClient();

  return useMutation<TransactionItem, unknown, { transactionId: string }>({
    mutationFn: ({ transactionId }) =>
      financeService.reopen(eventId, transactionId),
    onSuccess: async (_updated, variables) => {
      await invalidateFinance(queryClient, eventId, variables.transactionId);
    },
    onError: (error, variables) =>
      refreshOnConflict(queryClient, eventId, variables.transactionId)(error),
  });
}

/** Catat pembayaran APPROVED → PAID + ledger posting (Chair). */
export function usePayTransaction(eventId: string) {
  const queryClient = useQueryClient();

  return useMutation<
    PayTransactionResult,
    unknown,
    { transactionId: string } & PayTransactionInput
  >({
    mutationFn: ({ transactionId, narration }) =>
      financeService.pay(eventId, transactionId, { narration }),
    onSuccess: async (_result, variables) => {
      await invalidateFinance(queryClient, eventId, variables.transactionId);
    },
    onError: (error, variables) =>
      refreshOnConflict(queryClient, eventId, variables.transactionId)(error),
  });
}

/** Batalkan transaksi sesuai matriks §5.C. */
export function useCancelTransaction(eventId: string) {
  const queryClient = useQueryClient();

  return useMutation<
    TransactionItem,
    unknown,
    { transactionId: string } & CancelTransactionInput
  >({
    mutationFn: ({ transactionId, reason }) =>
      financeService.cancel(eventId, transactionId, { reason }),
    onSuccess: async (_updated, variables) => {
      await invalidateFinance(queryClient, eventId, variables.transactionId);
    },
    onError: (error, variables) =>
      refreshOnConflict(queryClient, eventId, variables.transactionId)(error),
  });
}

/** Reversal transaksi PAID (Chair, wajib alasan). */
export function useReverseTransaction(eventId: string) {
  const queryClient = useQueryClient();

  return useMutation<
    ReverseTransactionResult,
    unknown,
    { transactionId: string } & ReverseTransactionInput
  >({
    mutationFn: ({ transactionId, reason }) =>
      financeService.reverse(eventId, transactionId, { reason }),
    onSuccess: async (_result, variables) => {
      await invalidateFinance(queryClient, eventId, variables.transactionId);
    },
    onError: (error, variables) =>
      refreshOnConflict(queryClient, eventId, variables.transactionId)(error),
  });
}
