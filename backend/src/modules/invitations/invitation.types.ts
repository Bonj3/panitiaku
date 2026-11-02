export interface InvitationRow {
  id: string;
  eventId: string;
  email: string;
  role: "DIVISION_LEADER" | "MEMBER";
  status: "PENDING" | "ACCEPTED" | "REVOKED" | "EXPIRED";
  parentId: string | null;
  invitedById: string;
  acceptedById: string | null;
  acceptedAt: Date | null;
  revokedAt: Date | null;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface InvitationWithInviter extends InvitationRow {
  invitedBy: {
    id: string;
    userId: string;
    name: string;
    email: string;
    role: string;
    status: string;
  } | null;
}

export interface PaginatedInvitations {
  items: InvitationWithInviter[];
  meta: {
    page: number;
    perPage: number;
    total: number;
    totalPages: number;
  };
}

export interface PublicInvitationDetail {
  eventName: string;
  eventSlug: string;
  eventStatus: "OPEN" | "CLOSED";
  role: "DIVISION_LEADER" | "MEMBER";
  expiresAt: Date;
}

export interface CreateInvitationResult {
  invitation: {
    id: string;
    eventId: string;
    email: string;
    role: "DIVISION_LEADER" | "MEMBER";
    status: "PENDING";
    parentId: string | null;
    invitedById: string;
    expiresAt: Date;
    createdAt: Date;
  };
  token: string; // plaintext, HANYA di respons ini
}
