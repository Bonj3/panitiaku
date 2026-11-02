import { apiClient } from "@/lib/api-client";
import type {
  MemberDetailResponse,
  MemberListResponse,
  MemberQueryParams,
  MoveMemberResult,
  OrganizationTree,
  OrgStatus,
  SubtreeResponse,
  UpdateMemberResult,
  UpdateMemberRole,
} from "./organization.types";

function eventPath(eventId: string): string {
  return `/events/${encodeURIComponent(eventId)}`;
}

/** Bangun query string ?page&perPage&q&role&status (kosong dilewati). */
function toQuery(params: MemberQueryParams): string {
  const search = new URLSearchParams();
  if (params.page !== undefined) search.set("page", String(params.page));
  if (params.perPage !== undefined)
    search.set("perPage", String(params.perPage));
  const q = params.q?.trim();
  if (q) search.set("q", q);
  if (params.role) search.set("role", params.role);
  if (params.status) search.set("status", params.status);
  const text = search.toString();
  return text ? `?${text}` : "";
}

/**
 * Lapisan service organization di atas api-client terpusat.
 * Satu-satunya lapisan yang boleh memanggil HTTP untuk domain ini —
 * komponen UI memanggil hooks (`use-organization.ts`), bukan service ini langsung.
 */
export const organizationService = {
  /** GET /events/:eventId/organization → pohon lengkap siap React Flow. */
  getOrganization(eventId: string): Promise<OrganizationTree> {
    return apiClient.get<OrganizationTree>(
      `${eventPath(eventId)}/organization`,
    );
  },

  /** GET /events/:eventId/organization/subtree/:memberId → flat nodes subtree. */
  getSubtree(eventId: string, memberId: string): Promise<SubtreeResponse> {
    return apiClient.get<SubtreeResponse>(
      `${eventPath(eventId)}/organization/subtree/${encodeURIComponent(memberId)}`,
    );
  },

  /** GET /events/:eventId/members?page&perPage&q&role&status */
  getMembers(
    eventId: string,
    params: MemberQueryParams,
  ): Promise<MemberListResponse> {
    return apiClient.get<MemberListResponse>(
      `${eventPath(eventId)}/members${toQuery(params)}`,
    );
  },

  /** GET /events/:eventId/members/:memberId → member + parent + children. */
  getMember(eventId: string, memberId: string): Promise<MemberDetailResponse> {
    return apiClient.get<MemberDetailResponse>(
      `${eventPath(eventId)}/members/${encodeURIComponent(memberId)}`,
    );
  },

  /** PATCH /events/:eventId/members/:memberId/status */
  updateMemberStatus(
    eventId: string,
    memberId: string,
    status: OrgStatus,
  ): Promise<UpdateMemberResult> {
    return apiClient.patch<UpdateMemberResult>(
      `${eventPath(eventId)}/members/${encodeURIComponent(memberId)}/status`,
      { status },
    );
  },

  /** PATCH /events/:eventId/members/:memberId/role */
  updateMemberRole(
    eventId: string,
    memberId: string,
    role: UpdateMemberRole,
  ): Promise<UpdateMemberResult> {
    return apiClient.patch<UpdateMemberResult>(
      `${eventPath(eventId)}/members/${encodeURIComponent(memberId)}/role`,
      { role },
    );
  },

  /** POST /events/:eventId/members/:memberId/move */
  moveMember(
    eventId: string,
    memberId: string,
    newParentId: string,
  ): Promise<MoveMemberResult> {
    return apiClient.post<MoveMemberResult>(
      `${eventPath(eventId)}/members/${encodeURIComponent(memberId)}/move`,
      { newParentId },
    );
  },
};
