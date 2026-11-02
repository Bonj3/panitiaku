import { apiClient } from "@/lib/api-client";

/** Tipe kontrak auth (§13 + backend auth.service). */
export interface AuthUser {
  id: string;
  email: string;
  name: string;
}

export interface AuthMembershipEvent {
  id: string;
  name: string;
  slug: string;
  status: string;
}

export interface AuthMembership {
  id: string;
  eventId: string;
  userId: string;
  role: string;
  status: string;
  /** Ringkasan event pemilik membership (dikembalikan oleh GET /auth/me). */
  event: AuthMembershipEvent;
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface RegisterInput {
  name: string;
  email: string;
  password: string;
}

/**
 * Wrapper tipis di atas api-client terpusat. Endpoint auth selalu memakai
 * `skipAuthRefresh: true` agar tidak memicu loop refresh-otomatis.
 */
export const authService = {
  register(input: RegisterInput): Promise<{ user: AuthUser }> {
    return apiClient.post<{ user: AuthUser }>("/auth/register", input, {
      skipAuthRefresh: true,
    });
  },

  login(input: LoginInput): Promise<{ user: AuthUser }> {
    return apiClient.post<{ user: AuthUser }>("/auth/login", input, {
      skipAuthRefresh: true,
    });
  },

  logout(): Promise<{ loggedOut: boolean }> {
    return apiClient.post<{ loggedOut: boolean }>(
      "/auth/logout",
      {},
      { skipAuthRefresh: true },
    );
  },

  refresh(): Promise<{ user: AuthUser }> {
    return apiClient.post<{ user: AuthUser }>(
      "/auth/refresh",
      {},
      { skipAuthRefresh: true },
    );
  },

  me(): Promise<{ user: AuthUser; memberships: AuthMembership[] }> {
    return apiClient.get<{ user: AuthUser; memberships: AuthMembership[] }>(
      "/auth/me",
      { skipAuthRefresh: true },
    );
  },
};
