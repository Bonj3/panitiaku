export type OrgRole = "EVENT_CHAIR" | "DIVISION_LEADER" | "MEMBER";
export type OrgStatus = "ACTIVE" | "INACTIVE";

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

export interface OrganizationTree {
  root: string;
  nodes: OrgTreeNode[];
  edges: OrgTreeEdge[];
}

export interface OrgTreeRow {
  id: string;
  userId: string;
  name: string;
  role: OrgRole;
  parentId: string | null;
  title: string | null;
  status: OrgStatus;
  depth: number;
}

export interface MemberWithParentAndChildren {
  member: {
    id: string;
    userId: string;
    name: string;
    role: OrgRole;
    status: OrgStatus;
    title: string | null;
    parentId: string | null;
  };
  parent: {
    id: string;
    name: string;
    role: OrgRole;
    status: OrgStatus;
  } | null;
  children: Array<{
    id: string;
    name: string;
    role: OrgRole;
    status: OrgStatus;
  }>;
}

export interface PaginatedMembers {
  items: Array<{
    id: string;
    userId: string;
    name: string;
    role: OrgRole;
    status: OrgStatus;
    title: string | null;
    parentId: string | null;
  }>;
  meta: {
    page: number;
    perPage: number;
    total: number;
    totalPages: number;
  };
}
