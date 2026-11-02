import type {
  OrganizationTree,
  OrgTreeNode,
} from "./organization.types";

/**
 * Helper izin sisi klien — HANYA untuk menyembunyikan tombol aksi di UI.
 * Backend tetap satu-satunya penegak otorisasi (§4.4, jangan pernah
 * mengandalkan UI sebagai otorisasi).
 */

function buildChildrenMap(nodes: OrgTreeNode[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const node of nodes) {
    if (node.parentId === null) continue;
    const list = map.get(node.parentId) ?? [];
    list.push(node.id);
    map.set(node.parentId, list);
  }
  return map;
}

function collectDescendants(
  nodes: OrgTreeNode[],
  startId: string,
  includeStart: boolean,
): Set<string> {
  const childrenByParent = buildChildrenMap(nodes);
  const result = new Set<string>();
  const queue: string[] = includeStart
    ? [startId]
    : [...(childrenByParent.get(startId) ?? [])];
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined || result.has(current)) continue;
    result.add(current);
    const children = childrenByParent.get(current) ?? [];
    for (const child of children) queue.push(child);
  }
  return result;
}

/**
 * Id anggota dalam subtree (termasuk dirinya sendiri), dihitung dari tree
 * klien. Dipakai untuk UX division leader — backend tetap penegak.
 */
export function getClientSubtreeIds(
  tree: OrganizationTree,
  memberId: string,
): Set<string> {
  return collectDescendants(tree.nodes, memberId, true);
}

/**
 * Id keturunan (tanpa diri sendiri). Dipakai untuk mengecualikan opsi induk
 * pada dialog pindah (mencegah cycle di sisi UX).
 */
export function getDescendantIds(
  nodes: OrgTreeNode[],
  memberId: string,
): Set<string> {
  return collectDescendants(nodes, memberId, false);
}

export interface PermissionTarget {
  id: string;
  role: string;
}

/**
 * Chair boleh ubah role LEADER↔MEMBER — kecuali target dirinya sendiri
 * dan kecuali target Ketua Event (root).
 */
export function canEditRole(
  actorRole: string,
  actorMemberId: string,
  target: PermissionTarget,
): boolean {
  if (actorRole !== "EVENT_CHAIR") return false;
  if (target.id === actorMemberId) return false;
  if (target.role === "EVENT_CHAIR") return false;
  return true;
}

/**
 * Chair boleh ubah status siapa pun (kecuali diri sendiri & root).
 * Division leader hanya untuk anggota dalam subtree-nya.
 * Member read-only.
 */
export function canEditStatus(
  actorRole: string,
  actorMemberId: string,
  target: PermissionTarget,
  rootId: string,
  leaderSubtreeIds: Set<string> | null,
): boolean {
  if (target.id === actorMemberId) return false;
  if (target.id === rootId) return false;
  if (actorRole === "EVENT_CHAIR") return true;
  if (actorRole === "DIVISION_LEADER")
    return leaderSubtreeIds?.has(target.id) ?? false;
  return false;
}

/**
 * Aturan pindah sama dengan ubah status (root tidak boleh dipindah —
 * backend menolak dengan 422).
 */
export function canMoveMember(
  actorRole: string,
  actorMemberId: string,
  target: PermissionTarget,
  rootId: string,
  leaderSubtreeIds: Set<string> | null,
): boolean {
  return canEditStatus(
    actorRole,
    actorMemberId,
    target,
    rootId,
    leaderSubtreeIds,
  );
}
