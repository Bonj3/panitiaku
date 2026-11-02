import { useQuery } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import { invitationService } from "./invitation.service";
import type {
  AcceptInvitationResult,
  CreateInvitationInput,
  CreateInvitationResult,
  InvitationListResponse,
  InvitationQueryParams,
  PublicInvitationDetail,
  RevokeInvitationResult,
} from "./invitation.types";

export interface UseInvitationsParams {
  page?: number;
  perPage?: number;
  status?: string;
}

/**
 * Hooks TanStack Query untuk domain invitations.
 * Query list mengikuti kunci hierarkis
 * ['events', eventId, 'invitations', params] (§7 Aturan keras #2).
 */

/**
 * Daftar undangan event (butuh sesi + membership aktif).
 * `retry: false` agar 403 langsung ditangani UI tanpa pengulangan sia-sia.
 */
export function useInvitations(
  eventId: string | undefined,
  params: UseInvitationsParams,
) {
  const normalized: InvitationQueryParams = {
    page: params.page ?? 1,
    perPage: params.perPage ?? 20,
    status: params.status ?? "",
  };
  return useQuery<InvitationListResponse>({
    queryKey:
      eventId && eventId !== ""
        ? queryKeys.events.invitations(eventId, normalized)
        : (["events", "invitations", "missing"] as const),
    queryFn: () =>
      invitationService.getList(eventId as string, {
        page: normalized.page,
        perPage: normalized.perPage,
        status: normalized.status || undefined,
      }),
    enabled: Boolean(eventId),
    placeholderData: (previous) => previous,
    retry: false,
    staleTime: 15_000,
  });
}

/**
 * Detail publik undangan dari token (tanpa sesi).
 * `retry: false` agar 404/410 langsung ditampilkan di AcceptInvitationPage.
 */
export function usePublicInvitation(token: string | undefined) {
  return useQuery<PublicInvitationDetail>({
    queryKey: token
      ? (["invitations", "public", token] as const)
      : (["invitations", "public", "missing"] as const),
    queryFn: () => invitationService.getPublic(token as string),
    enabled: Boolean(token),
    retry: false,
    staleTime: 30_000,
  });
}

/**
 * Invalidasi cache undangan + struktur + anggota setelah mutasi event-scoped.
 * Termasuk ['auth','me'] bila keanggotaan berubah (accept undangan).
 *
 * Catatan: cache detail event SENGAJA tidak diinvalidasi — data detail
 * (nama/slug/status/membership) tidak berubah oleh mutasi undangan, dan
 * invalidasinya membuat EventDetailPage refetch (isFetching) sehingga
 * seluruh konten termasuk dialog "Undang anggota" ter-unmount dan panel
 * hasil berisi token hilang sebelum sempat disalin.
 */
async function invalidateAfterInvitationMutation(
  queryClient: QueryClient,
  eventId: string,
): Promise<void> {
  await queryClient.invalidateQueries({
    queryKey: queryKeys.events.invitations(eventId),
  });
  await queryClient.invalidateQueries({
    queryKey: queryKeys.events.organization(eventId),
  });
  await queryClient.invalidateQueries({
    queryKey: ["events", eventId, "members"],
  });
  await queryClient.invalidateQueries({ queryKey: queryKeys.auth.me });
}

/** Buat undangan → invalidasi invitations + organization + members. */
export function useCreateInvitation(eventId: string) {
  const queryClient = useQueryClient();
  return useMutation<
    CreateInvitationResult,
    unknown,
    CreateInvitationInput
  >({
    mutationFn: (input) => invitationService.create(eventId, input),
    onSuccess: async () => {
      await invalidateAfterInvitationMutation(queryClient, eventId);
    },
  });
}

/** Cabut undangan PENDING → invalidasi invitations (+ tree/members). */
export function useRevokeInvitation(eventId: string) {
  const queryClient = useQueryClient();
  return useMutation<
    RevokeInvitationResult,
    unknown,
    { invitationId: string }
  >({
    mutationFn: ({ invitationId }) =>
      invitationService.revoke(eventId, invitationId),
    onSuccess: async () => {
      await invalidateAfterInvitationMutation(queryClient, eventId);
    },
  });
}

/**
 * Terima undangan publik → invalidasi ['auth','me'] + cache event tujuan.
 * Navigasi ke `/events/:eventId` ditangani pemanggil dari hasil membership.
 */
export function useAcceptInvitation() {
  const queryClient = useQueryClient();
  return useMutation<AcceptInvitationResult, unknown, { token: string }>({
    mutationFn: ({ token }) => invitationService.accept(token),
    onSuccess: async (data) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.auth.me });
      await invalidateAfterInvitationMutation(
        queryClient,
        data.membership.eventId,
      );
    },
  });
}
