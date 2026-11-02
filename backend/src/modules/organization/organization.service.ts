import { prisma } from "../../config/database.js";
import {
  ForbiddenError,
  NotFoundError,
  UnprocessableError,
} from "../../shared/errors/app-error.js";
import { writeAudit } from "../audit/audit.service.js";
import type { EventMembership } from "../../shared/types/http.js";
import type { OrganizationTree, PaginatedMembers } from "./organization.types.js";
import {
  getTreeRows,
  getSubtreeIds,
  getMemberWithUser,
  type QueryClient,
} from "./organization.repository.js";

export { getSubtreeIds };

type Role = EventMembership["role"];

function toNode(row: { id: string; name: string; role: string; status: string; title: string | null; parentId: string | null; depth: number }) {
  return {
    id: row.id,
    name: row.name,
    role: row.role as Role,
    status: row.status as "ACTIVE" | "INACTIVE",
    title: row.title,
    parentId: row.parentId,
    depth: row.depth,
  };
}

/**
 * GET /events/:eventId/organization → pohon lengkap siap React Flow.
 */
export async function getTree(eventId: string): Promise<OrganizationTree> {
  const rows = await getTreeRows(eventId);
  if (rows.length === 0) {
    throw new NotFoundError("Event tidak memiliki anggota");
  }

  const root = rows.find((r) => r.parentId === null);
  if (!root) {
    throw new NotFoundError("Root event tidak ditemukan");
  }

  const nodes = rows.map(toNode);
  const edges = rows
    .filter((r) => r.parentId !== null)
    .map((r) => ({
      id: `e-${r.parentId}-${r.id}`,
      source: r.parentId as string,
      target: r.id,
    }));

  return { root: root.id, nodes, edges };
}

/**
 * GET /events/:eventId/organization/subtree/:memberId → flat nodes subtree.
 */
export async function getSubtree(
  eventId: string,
  memberId: string,
): Promise<{ nodes: ReturnType<typeof toNode>[] }> {
  const member = await getMemberWithUser(eventId, memberId);
  if (!member) {
    throw new NotFoundError("Anggota tidak ditemukan pada event ini");
  }

  const subtreeIds = await getSubtreeIds(eventId, memberId);
  const rows = await getTreeRows(eventId);
  const subtreeRows = rows.filter((r) => subtreeIds.includes(r.id));
  subtreeRows.sort((a, b) => a.depth - b.depth || a.id.localeCompare(b.id));

  return { nodes: subtreeRows.map(toNode) };
}

/**
 * GET /events/:eventId/members?page&perPage&q&role&status
 */
export async function listMembers(
  eventId: string,
  input: {
    page: number;
    perPage: number;
    q?: string;
    role?: Role;
    status?: "ACTIVE" | "INACTIVE";
  },
): Promise<PaginatedMembers> {
  const page = Math.max(1, input.page);
  const perPage = Math.min(100, Math.max(1, input.perPage));
  const skip = (page - 1) * perPage;

  const where: Record<string, unknown> = { eventId };
  if (input.role) where.role = input.role;
  if (input.status) where.status = input.status;
  if (input.q) {
    // Pencarian hanya melalui nama: email tidak diekspos/dapat dicari melalui
    // daftar anggota untuk meminimalkan pencocokan email (enumerasi).
    (where as Record<string, unknown>).OR = [
      { user: { name: { contains: input.q, mode: "insensitive" } } },
    ];
  }

  const [items, total] = await Promise.all([
    prisma.eventMember.findMany({
      where,
      select: {
        id: true,
        userId: true,
        role: true,
        status: true,
        title: true,
        parentId: true,
        user: { select: { name: true } },
      },
      orderBy: [{ user: { name: "asc" } }, { createdAt: "asc" }],
      skip,
      take: perPage,
    }),
    prisma.eventMember.count({ where }),
  ]);

  const totalPages = Math.ceil(total / perPage);

  return {
    items: items.map((it) => ({
      id: it.id,
      userId: it.userId,
      name: it.user.name,
      role: it.role as Role,
      status: it.status as "ACTIVE" | "INACTIVE",
      title: it.title ?? null,
      parentId: it.parentId ?? null,
    })),
    meta: { page, perPage, total, totalPages },
  };
}

/**
 * GET /events/:eventId/members/:memberId → member + parent + children.
 */
export async function getMemberDetail(
  eventId: string,
  memberId: string,
): Promise<{
  member: { id: string; userId: string; name: string; role: Role; status: "ACTIVE" | "INACTIVE"; title: string | null; parentId: string | null };
  parent: { id: string; name: string; role: Role; status: "ACTIVE" | "INACTIVE" } | null;
  children: Array<{ id: string; name: string; role: Role; status: "ACTIVE" | "INACTIVE" }>;
}> {
  const member = await getMemberWithUser(eventId, memberId);
  if (!member) {
    throw new NotFoundError("Anggota tidak ditemukan pada event ini");
  }

  const parent =
    member.parentId !== null
      ? await prisma.eventMember.findFirst({
          where: { id: member.parentId, eventId },
          select: {
            id: true,
            userId: true,
            role: true,
            status: true,
            user: { select: { name: true } },
          },
        })
      : null;

  const children = await prisma.eventMember.findMany({
    where: { parentId: member.id, eventId },
    select: {
      id: true,
      userId: true,
      role: true,
      status: true,
      user: { select: { name: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  return {
    member: {
      id: member.id,
      userId: member.userId,
      name: member.user.name,
      role: member.role as Role,
      status: member.status as "ACTIVE" | "INACTIVE",
      title: member.title ?? null,
      parentId: member.parentId ?? null,
    },
    parent: parent
      ? {
          id: parent.id,
          name: parent.user.name,
          role: parent.role as Role,
          status: parent.status as "ACTIVE" | "INACTIVE",
        }
      : null,
    children: children.map((c) => ({
      id: c.id,
      name: c.user.name,
      role: c.role as Role,
      status: c.status as "ACTIVE" | "INACTIVE",
    })),
  };
}

/**
 * isInSubtree — candidate ada dalam subtree ancestor (termasuk ancestor).
 */
export async function isInSubtree(
  eventId: string,
  ancestorId: string,
  candidateId: string,
  client?: QueryClient,
): Promise<boolean> {
  const ids = await getSubtreeIds(eventId, ancestorId, client);
  return ids.includes(candidateId);
}

/**
 * PATCH status member.
 */
export async function updateStatus(
  eventId: string,
  actor: EventMembership,
  targetId: string,
  status: "ACTIVE" | "INACTIVE",
): Promise<{ member: { id: string; userId: string; name: string; role: Role; status: "ACTIVE" | "INACTIVE"; title: string | null; parentId: string | null } }> {
  return prisma.$transaction(async (tx) => {
    // Lock baris event yang sama dengan accept/create/revoke/move. Ini
    // menyerialkan perubahan status dengan re-validasi inviter/parent saat
    // accept undangan (BR-05) dan dengan perubahan struktur.
    await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM events WHERE id = ${eventId}::uuid FOR UPDATE;
    `;

    // Re-baca aktor dari DB: role/status dari middleware bisa sudah basi bila
    // diubah request lain sesudah middleware berjalan.
    const actorNow = await tx.eventMember.findFirst({
      where: { id: actor.id, eventId },
      select: { id: true, role: true, status: true },
    });
    if (!actorNow || actorNow.status !== "ACTIVE") {
      throw new ForbiddenError("Keanggotaan Anda tidak aktif pada event ini");
    }

    const target = await tx.eventMember.findFirst({
      where: { id: targetId, eventId },
      select: {
        id: true,
        userId: true,
        role: true,
        status: true,
        parentId: true,
        title: true,
        user: { select: { name: true } },
      },
    });
    if (!target) {
      throw new NotFoundError("Anggota target tidak ditemukan");
    }

    // Tidak boleh mengubah status anggota sendiri (bandingkan id event_member,
    // bukan userId).
    if (targetId === actorNow.id) {
      throw new UnprocessableError("Tidak boleh mengubah status anggota sendiri");
    }

    if (status === "INACTIVE" && target.role === "EVENT_CHAIR") {
      throw new UnprocessableError("Tidak boleh menonaktifkan Ketua Event (root)");
    }

    if (actorNow.role === "EVENT_CHAIR") {
      // boleh siapa pun
    } else if (actorNow.role === "DIVISION_LEADER") {
      // actor.id dan targetId adalah id event_member (node pohon), bukan userId.
      if (!(await isInSubtree(eventId, actorNow.id, targetId, tx))) {
        throw new ForbiddenError(
          "Division leader hanya dapat mengubah anggota dalam subtree miliknya",
        );
      }
    } else {
      throw new ForbiddenError("Role Anda tidak diizinkan mengubah status");
    }

    const updated = await tx.eventMember.update({
      where: { id: targetId },
      data: { status },
      select: { id: true, userId: true, role: true, status: true, parentId: true, title: true },
    });

    await writeAudit(tx, {
      eventId,
      actorId: actorNow.id,
      action: 'member.status.update',
      entityType: 'member',
      entityId: targetId,
      metadata: { fromStatus: target.status, toStatus: status },
    });

    return {
      member: {
        id: updated.id,
        userId: updated.userId,
        name: target.user.name,
        role: updated.role as Role,
        status: updated.status as "ACTIVE" | "INACTIVE",
        title: updated.title ?? null,
        parentId: updated.parentId ?? null,
      },
    };
  });
}

/**
 * PATCH role member. Hanya EVENT_CHAIR (dipastikan route).
 */
export async function updateRole(
  eventId: string,
  actor: EventMembership,
  targetId: string,
  role: "DIVISION_LEADER" | "MEMBER",
): Promise<{ member: { id: string; userId: string; name: string; role: Role; status: "ACTIVE" | "INACTIVE"; title: string | null; parentId: string | null } }> {
  return prisma.$transaction(async (tx) => {
    // Lock event yang sama dengan accept/create/revoke/move.
    await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM events WHERE id = ${eventId}::uuid FOR UPDATE;
    `;

    const actorNow = await tx.eventMember.findFirst({
      where: { id: actor.id, eventId },
      select: { id: true, role: true, status: true },
    });
    if (!actorNow || actorNow.status !== "ACTIVE") {
      throw new ForbiddenError("Keanggotaan Anda tidak aktif pada event ini");
    }
    if (actorNow.role !== "EVENT_CHAIR") {
      throw new ForbiddenError("Hanya Ketua Event yang dapat mengubah role");
    }

    const target = await tx.eventMember.findFirst({
      where: { id: targetId, eventId },
      select: {
        id: true,
        userId: true,
        role: true,
        status: true,
        parentId: true,
        title: true,
        user: { select: { name: true } },
      },
    });
    if (!target) {
      throw new NotFoundError("Anggota target tidak ditemukan");
    }

    // Tidak boleh mengubah role anggota sendiri.
    if (targetId === actorNow.id) {
      throw new UnprocessableError("Tidak boleh mengubah role anggota sendiri");
    }

  // role EVENT_CHAIR tidak dapat sampai ke sini: updateRoleSchema hanya
  // membuka DIVISION_LEADER | MEMBER (validator → 422 kalau diabaikan klien).
  // Pertahanan lapis aplikasi di sengaja tidak ditulis ulang karena TipeScript
  // menandai bandingannya sebagai kode mati (role tidak mungkin EVENT_CHAIR).

  const updated = await tx.eventMember.update({
    where: { id: targetId },
    data: { role },
    select: { id: true, userId: true, role: true, status: true, parentId: true, title: true },
  });

  await writeAudit(tx, {
    eventId,
    actorId: actorNow.id,
    action: 'member.role.update',
    entityType: 'member',
    entityId: targetId,
    metadata: { fromRole: target.role, toRole: role },
  });

  return {
    member: {
      id: updated.id,
      userId: updated.userId,
      name: target.user.name,
      role: updated.role as Role,
      status: updated.status as "ACTIVE" | "INACTIVE",
      title: updated.title ?? null,
      parentId: updated.parentId ?? null,
    },
  };
  });
}

/**
 * POST move member. Transaksi interaktif + LOCK event row.
 */
export async function moveMember(
  eventId: string,
  actor: EventMembership,
  targetId: string,
  newParentId: string,
): Promise<{ member: { id: string; userId: string; name: string; role: Role; status: "ACTIVE" | "INACTIVE"; title: string | null; parentId: string | null }; noop: boolean }> {
  return prisma.$transaction(async (tx) => {
    // Lock baris event untuk serialisasi perubahan struktur.
    await tx.$queryRaw<{ id: string }[]>`SELECT id FROM events WHERE id = ${eventId}::uuid FOR UPDATE;`;

    // Re-baca aktor: role/status bisa berubah setelah middleware berjalan.
    const actorNow = await tx.eventMember.findFirst({
      where: { id: actor.id, eventId },
      select: { id: true, role: true, status: true },
    });
    if (!actorNow || actorNow.status !== "ACTIVE") {
      throw new ForbiddenError("Keanggotaan Anda tidak aktif pada event ini");
    }

    const target = await tx.eventMember.findFirst({
      where: { id: targetId, eventId },
      select: {
        id: true,
        userId: true,
        role: true,
        status: true,
        parentId: true,
        title: true,
        user: { select: { name: true } },
      },
    });
    if (!target) {
      throw new NotFoundError("Anggota target tidak ditemukan");
    }

    // Root EVENT_CHAIR tidak boleh dipindah.
    if (target.role === "EVENT_CHAIR" && target.parentId === null) {
      throw new UnprocessableError("Root Ketua Event tidak boleh dipindahkan");
    }

    if (newParentId === target.id) {
      throw new UnprocessableError("Anggota tidak boleh menjadi induk diri sendiri");
    }

    const newParent = await tx.eventMember.findFirst({
      where: { id: newParentId, eventId },
      select: {
        id: true,
        userId: true,
        status: true,
        user: { select: { name: true } },
      },
    });
    if (!newParent) {
      throw new UnprocessableError("Induk baru tidak ditemukan");
    }
    if (newParent.status !== "ACTIVE") {
      throw new UnprocessableError("Induk baru harus status ACTIVE");
    }

    // Cycle: newParent tidak boleh berada dalam subtree target.
    const subtreeIds = await getSubtreeIds(eventId, targetId, tx);
    if (subtreeIds.includes(newParentId)) {
      throw new UnprocessableError("Tidak boleh memindahkan ke dalam subtree sendiri (cycle)");
    }

    // Otorisasi per actor.
    if (actorNow.role === "EVENT_CHAIR") {
      // boleh semua
    } else if (actorNow.role === "DIVISION_LEADER") {
      // actor.id, targetId, newParentId adalah id event_member (node pohon).
      const actorInSubtree = await isInSubtree(eventId, actorNow.id, targetId, tx);
      const newParentInSubtree = await isInSubtree(eventId, actorNow.id, newParentId, tx);
      if (!actorInSubtree || !newParentInSubtree) {
        throw new ForbiddenError("Division leader hanya dapat memindahkan anggota dalam subtree miliknya");
      }
    } else {
      throw new ForbiddenError("Role Anda tidak diizinkan memindahkan anggota");
    }

    // No-op: parent sama → 200 tanpa update. Masih ditulis audit karena aksi
    // percobaannya dilakukan oleh aktor berhak.
    if (target.parentId === newParentId) {
      await writeAudit(tx, {
        eventId,
        actorId: actorNow.id,
        action: 'member.move',
        entityType: 'member',
        entityId: targetId,
        metadata: { oldParentId: target.parentId, newParentId, noop: true },
      });

      return {
        member: {
          id: target.id,
          userId: target.userId,
          name: target.user.name,
          role: target.role as Role,
          status: target.status as "ACTIVE" | "INACTIVE",
          title: target.title ?? null,
          parentId: target.parentId ?? null,
        },
        noop: true,
      };
    }

    const updated = await tx.eventMember.update({
      where: { id: targetId },
      data: { parentId: newParentId },
      select: { id: true, userId: true, role: true, status: true, parentId: true, title: true },
    });

    await writeAudit(tx, {
      eventId,
      actorId: actorNow.id,
      action: 'member.move',
      entityType: 'member',
      entityId: targetId,
      metadata: { oldParentId: target.parentId, newParentId, noop: false },
    });

    return {
      member: {
        id: updated.id,
        userId: updated.userId,
        name: target.user.name,
        role: updated.role as Role,
        status: updated.status as "ACTIVE" | "INACTIVE",
        title: updated.title ?? null,
        parentId: updated.parentId ?? null,
      },
      noop: false,
    };
  });
}
