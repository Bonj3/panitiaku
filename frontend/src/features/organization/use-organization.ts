import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import { organizationService } from "./organization.service";
import type {
  MemberDetailResponse,
  MemberListResponse,
  MoveMemberResult,
  OrganizationTree,
  OrgStatus,
  SubtreeResponse,
  UpdateMemberResult,
  UpdateMemberRole,
} from "./organization.types";

export interface UseMembersParams {
  page?: number;
  perPage?: number;
  q?: string;
  role?: string;
  status?: string;
}

/**
 * Hooks TanStack Query untuk domain organization & members.
 * Kunci mengikuti factory hierarkis `queryKeys.events` (§7 Aturan keras #2):
 * ['events', eventId, 'organization'] dan ['events', eventId, 'members', ...].
 */

/**
 * Pohon organisasi lengkap (siap React Flow).
 * `retry: false` agar 403/404 langsung ditangani UI tanpa pengulangan sia-sia.
 */
export function useOrganization(eventId: string | undefined) {
  return useQuery<OrganizationTree>({
    queryKey: eventId
      ? queryKeys.events.organization(eventId)
      : (["events", "organization", "missing"] as const),
    queryFn: () => organizationService.getOrganization(eventId as string),
    enabled: Boolean(eventId),
    retry: false,
    staleTime: 30_000,
  });
}

/** Flat nodes subtree satu anggota. */
export function useSubtree(
  eventId: string | undefined,
  memberId: string | null | undefined,
) {
  return useQuery<SubtreeResponse>({
    queryKey:
      eventId && memberId
        ? queryKeys.events.subtree(eventId, memberId)
        : (["events", "organization", "subtree", "missing"] as const),
    queryFn: () =>
      organizationService.getSubtree(eventId as string, memberId as string),
    enabled: Boolean(eventId && memberId),
    retry: false,
    staleTime: 30_000,
  });
}

/**
 * Daftar anggota paginasi + filter.
 * Data sebelumnya dipertahankan (placeholderData) saat ganti halaman/filter
 * agar tabel tidak berkedip.
 */
export function useMembers(
  eventId: string | undefined,
  params: UseMembersParams,
) {
  const normalized = {
    page: params.page ?? 1,
    perPage: params.perPage ?? 10,
    q: params.q ?? "",
    role: params.role ?? "",
    status: params.status ?? "",
  };
  return useQuery<MemberListResponse>({
    queryKey: eventId
      ? queryKeys.events.members(eventId, normalized)
      : (["events", "members", "missing"] as const),
    queryFn: () =>
      organizationService.getMembers(eventId as string, {
        page: normalized.page,
        perPage: normalized.perPage,
        q: normalized.q || undefined,
        role: normalized.role || undefined,
        status: normalized.status || undefined,
      }),
    enabled: Boolean(eventId),
    placeholderData: (previous) => previous,
    staleTime: 15_000,
  });
}

/** Detail satu anggota + atasan + anak langsung. */
export function useMember(
  eventId: string | undefined,
  memberId: string | null | undefined,
) {
  return useQuery<MemberDetailResponse>({
    queryKey:
      eventId && memberId
        ? queryKeys.events.memberDetail(eventId, memberId)
        : (["events", "members", "detail", "missing"] as const),
    queryFn: () =>
      organizationService.getMember(eventId as string, memberId as string),
    enabled: Boolean(eventId && memberId),
    retry: false,
    staleTime: 15_000,
  });
}

/** Invalidasi tree + seluruh cache members (list & detail) setelah mutasi. */
async function invalidateOrganizationCaches(
  queryClient: QueryClient,
  eventId: string,
): Promise<void> {
  await queryClient.invalidateQueries({
    queryKey: queryKeys.events.organization(eventId),
  });
  await queryClient.invalidateQueries({
    queryKey: ["events", eventId, "members"],
  });
}

/** Ubah status anggota → invalidasi tree + members. */
export function useUpdateMemberStatus(eventId: string) {
  const queryClient = useQueryClient();
  return useMutation<
    UpdateMemberResult,
    unknown,
    { memberId: string; status: OrgStatus }
  >({
    mutationFn: ({ memberId, status }) =>
      organizationService.updateMemberStatus(eventId, memberId, status),
    onSuccess: async () => {
      await invalidateOrganizationCaches(queryClient, eventId);
    },
  });
}

/** Ubah role anggota → invalidasi tree + members. */
export function useUpdateMemberRole(eventId: string) {
  const queryClient = useQueryClient();
  return useMutation<
    UpdateMemberResult,
    unknown,
    { memberId: string; role: UpdateMemberRole }
  >({
    mutationFn: ({ memberId, role }) =>
      organizationService.updateMemberRole(eventId, memberId, role),
    onSuccess: async () => {
      await invalidateOrganizationCaches(queryClient, eventId);
    },
  });
}

/** Pindahkan anggota → invalidasi tree + members. */
export function useMoveMember(eventId: string) {
  const queryClient = useQueryClient();
  return useMutation<
    MoveMemberResult,
    unknown,
    { memberId: string; newParentId: string }
  >({
    mutationFn: ({ memberId, newParentId }) =>
      organizationService.moveMember(eventId, memberId, newParentId),
    onSuccess: async () => {
      await invalidateOrganizationCaches(queryClient, eventId);
    },
  });
}
