import { apiClient } from "@/lib/api-client";
import type {
  AcceptInvitationResult,
  CreateInvitationInput,
  CreateInvitationResult,
  InvitationListResponse,
  InvitationQueryParams,
  PublicInvitationDetail,
  RevokeInvitationResult,
} from "./invitation.types";

function eventPath(eventId: string): string {
  return `/events/${encodeURIComponent(eventId)}`;
}

/** Bangun query string ?page&perPage&status (kosong dilewati). */
function toQuery(params: InvitationQueryParams): string {
  const search = new URLSearchParams();
  if (params.page !== undefined) search.set("page", String(params.page));
  if (params.perPage !== undefined)
    search.set("perPage", String(params.perPage));
  const status = params.status?.trim();
  if (status) search.set("status", status);
  const text = search.toString();
  return text ? `?${text}` : "";
}

/**
 * Lapisan service invitations di atas api-client terpusat.
 * Satu-satunya lapisan yang boleh memanggil HTTP untuk domain ini —
 * komponen UI memanggil hooks (`use-invitations.ts`), bukan service ini langsung.
 */
export const invitationService = {
  /** GET /events/:eventId/invitations?page&perPage&status */
  getList(
    eventId: string,
    params: InvitationQueryParams,
  ): Promise<InvitationListResponse> {
    return apiClient.get<InvitationListResponse>(
      `${eventPath(eventId)}/invitations${toQuery(params)}`,
    );
  },

  /** POST /events/:eventId/invitations → 201 { invitation, token }. */
  create(
    eventId: string,
    input: CreateInvitationInput,
  ): Promise<CreateInvitationResult> {
    return apiClient.post<CreateInvitationResult>(
      `${eventPath(eventId)}/invitations`,
      input,
    );
  },

  /** POST /events/:eventId/invitations/:invitationId/revoke */
  revoke(
    eventId: string,
    invitationId: string,
  ): Promise<RevokeInvitationResult> {
    return apiClient.post<RevokeInvitationResult>(
      `${eventPath(eventId)}/invitations/${encodeURIComponent(invitationId)}/revoke`,
      {},
    );
  },

  /** GET /invitations/:token (publik, tanpa sesi). */
  getPublic(token: string): Promise<PublicInvitationDetail> {
    return apiClient.get<PublicInvitationDetail>(
      `/invitations/${encodeURIComponent(token)}`,
    );
  },

  /** POST /invitations/:token/accept (butuh sesi + email cocok). */
  accept(token: string): Promise<AcceptInvitationResult> {
    return apiClient.post<AcceptInvitationResult>(
      `/invitations/${encodeURIComponent(token)}/accept`,
      {},
    );
  },
};
