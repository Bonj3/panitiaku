/**
 * Tipe kontrak invitations (PROJECT.md §13, terverifikasi terhadap backend
 * `invitation.types.ts` + `invitation.controller.ts`).
 */

/** Peran yang boleh diundang lewat POST /events/:eventId/invitations. */
export type InvitationRole = "DIVISION_LEADER" | "MEMBER";

/** Status undangan. */
export type InvitationStatus =
  | "PENDING"
  | "ACCEPTED"
  | "REVOKED"
  | "EXPIRED";

/** Satu baris daftar undangan (GET /events/:eventId/invitations). */
export interface InvitationListItem {
  id: string;
  eventId: string;
  email: string;
  role: InvitationRole;
  status: InvitationStatus;
  parentId: string | null;
  invitedById: string;
  acceptedById: string | null;
  acceptedAt: string | null;
  revokedAt: string | null;
  expiresAt: string;
  createdAt: string;
  invitedBy: {
    id: string;
    name: string;
    email: string;
    role: string;
    status: string;
  } | null;
}

export interface InvitationListMeta {
  page: number;
  perPage: number;
  total: number;
  totalPages: number;
}

export interface InvitationListResponse {
  items: InvitationListItem[];
  meta: InvitationListMeta;
}

export interface InvitationQueryParams {
  page?: number;
  perPage?: number;
  status?: string;
}

/** Hasil POST /events/:eventId/invitations — token plaintext HANYA di sini. */
export interface CreateInvitationResult {
  invitation: {
    id: string;
    eventId: string;
    email: string;
    role: InvitationRole;
    status: "PENDING";
    parentId: string | null;
    invitedById: string;
    expiresAt: string;
    createdAt: string;
  };
  /** Token mentah — tampilkan sekali, jangan disimpan persisten. */
  token: string;
}

export interface CreateInvitationInput {
  email: string;
  role: InvitationRole;
  parentId: string;
}

/** Detail publik undangan (GET /invitations/:token) — tanpa email/PII. */
export interface PublicInvitationDetail {
  eventName: string;
  eventSlug: string;
  eventStatus: "OPEN" | "CLOSED";
  role: InvitationRole;
  expiresAt: string;
}

/** Hasil POST /invitations/:token/accept. */
export interface AcceptInvitationResult {
  membership: {
    id: string;
    eventId: string;
    userId: string;
    role: string;
    status: string;
    parentId: string | null;
    title: string | null;
    event: {
      id: string;
      name: string;
      slug: string;
      status: string;
    };
  };
}

/** Hasil POST .../invitations/:invitationId/revoke. */
export interface RevokeInvitationResult {
  invitationId: string;
  status: "REVOKED";
}

export const INVITATION_ROLE_LABEL: Record<InvitationRole, string> = {
  DIVISION_LEADER: "Ketua Divisi",
  MEMBER: "Anggota",
};

export const INVITATION_STATUS_LABEL: Record<InvitationStatus, string> = {
  PENDING: "Menunggu",
  ACCEPTED: "Diterima",
  REVOKED: "Dicabut",
  EXPIRED: "Kedaluwarsa",
};
