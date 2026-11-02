/**
 * Tipe kontrak organization & members (PROJECT.md §13, terverifikasi terhadap
 * backend `organization.service.ts` + `organization.controller.ts`).
 *
 * Catatan penting: `id` adalah EVENT MEMBER id (id node pohon),
 * BUKAN user id.
 */

/** Peran keanggotaan dalam satu event. */
export type OrgRole = "EVENT_CHAIR" | "DIVISION_LEADER" | "MEMBER";

/** Status keanggotaan dalam satu event. */
export type OrgStatus = "ACTIVE" | "INACTIVE";

/** Satu node pohon organisasi (GET .../organization).
 *
 * Catatan Phase 7: `email` sengaja DIHAPUS dari respons organization/members.
 * PROJECT.md tidak mewajibkan menampilkan email anggota dalam tree/daftar
 * detail (node = nama, peran, status). Email hanya tersedia pada profil
 * sendiri (GET /auth/me) dan alur undangan (server-side binding).
 */
export interface OrgTreeNode {
  id: string;
  name: string;
  role: OrgRole;
  status: OrgStatus;
  title: string | null;
  parentId: string | null;
  depth: number;
}

export interface OrgTreeEdge {
  id: string;
  source: string;
  target: string;
}

/** Pohon lengkap siap React Flow (GET /events/:eventId/organization). */
export interface OrganizationTree {
  root: string;
  nodes: OrgTreeNode[];
  edges: OrgTreeEdge[];
}

/** Flat nodes subtree (GET .../organization/subtree/:memberId). */
export interface SubtreeResponse {
  nodes: OrgTreeNode[];
}

/** Satu baris daftar anggota (GET /events/:eventId/members).
 *
 * Catatan Phase 7: `email` DIHAPUS (lihat catatan di OrgTreeNode).
 */
export interface MemberListItem {
  id: string;
  userId: string;
  name: string;
  role: OrgRole;
  status: OrgStatus;
  title: string | null;
  parentId: string | null;
}

export interface MemberListMeta {
  page: number;
  perPage: number;
  total: number;
  totalPages: number;
}

export interface MemberListResponse {
  items: MemberListItem[];
  meta: MemberListMeta;
}

export interface MemberDetailParent {
  id: string;
  name: string;
  role: OrgRole;
  status: OrgStatus;
}

export interface MemberDetailChild {
  id: string;
  name: string;
  role: OrgRole;
  status: OrgStatus;
}

/** Detail anggota + atasan + anak langsung (GET .../members/:memberId). */
export interface MemberDetailResponse {
  member: MemberListItem;
  parent: MemberDetailParent | null;
  children: MemberDetailChild[];
}

export interface MemberQueryParams {
  page?: number;
  perPage?: number;
  q?: string;
  role?: string;
  status?: string;
}

/** Role yang boleh ditulis lewat PATCH .../members/:memberId/role. */
export type UpdateMemberRole = "DIVISION_LEADER" | "MEMBER";

/** Hasil PATCH status / role: `{ member }`. */
export interface UpdateMemberResult {
  member: MemberListItem;
}

/** Hasil POST .../members/:memberId/move: `{ member, noop }`. */
export interface MoveMemberResult {
  member: MemberListItem;
  noop: boolean;
}

export const ORG_ROLE_LABEL: Record<OrgRole, string> = {
  EVENT_CHAIR: "Ketua Event",
  DIVISION_LEADER: "Ketua Divisi",
  MEMBER: "Anggota",
};

export const ORG_STATUS_LABEL: Record<OrgStatus, string> = {
  ACTIVE: "Aktif",
  INACTIVE: "Nonaktif",
};
