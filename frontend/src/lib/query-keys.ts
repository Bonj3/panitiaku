/**
 * Query key factory hierarkis (§7 Aturan keras #2).
 *
 * Bentuk kunci:
 * - ['events', eventId, 'organization']
 * - ['events', eventId, 'transactions', params]
 */

export interface TransactionQueryParams {
  page?: number;
  perPage?: number;
  sort?: string;
  q?: string;
  type?: string;
  status?: string;
  category?: string;
  from?: string;
  to?: string;
}

export interface MemberQueryParams {
  page?: number;
  perPage?: number;
  sort?: string;
  q?: string;
  role?: string;
  status?: string;
}

export interface InvitationQueryParams {
  page?: number;
  perPage?: number;
  status?: string;
}

export const queryKeys = {
  events: {
    all: ["events"] as const,
    list: () => ["events", "list"] as const,
    detail: (eventId: string) => ["events", eventId] as const,
    organization: (eventId: string) =>
      ["events", eventId, "organization"] as const,
    subtree: (eventId: string, memberId: string) =>
      ["events", eventId, "organization", "subtree", memberId] as const,
    members: (eventId: string, params?: MemberQueryParams) =>
      ["events", eventId, "members", params ?? {}] as const,
    memberDetail: (eventId: string, memberId: string) =>
      ["events", eventId, "members", memberId] as const,
    invitations: (eventId: string, params?: InvitationQueryParams) =>
      ["events", eventId, "invitations", params ?? {}] as const,
    transactions: (eventId: string, params?: TransactionQueryParams) =>
      ["events", eventId, "transactions", params ?? {}] as const,
    transactionDetail: (eventId: string, transactionId: string) =>
      ["events", eventId, "transactions", transactionId] as const,
    summary: (eventId: string) =>
      ["events", eventId, "finance", "summary"] as const,
  },
  auth: {
    me: ["auth", "me"] as const,
  },
} as const;
