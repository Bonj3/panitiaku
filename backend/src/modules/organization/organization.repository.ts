import { prisma } from "../../config/database.js";
import type { Prisma } from "../../generated/prisma/client.js";
import type { OrgTreeRow } from "./organization.types.js";

/**
 * Klien query yang bisa berupa PrismaClient global atau transaction client.
 * CTE di dalam transaksi WAJIB memakai `tx` agar tidak memakai koneksi kedua
 * dari pool saat transaksi menahan lock (menghindari kehabisan pool).
 */
export type QueryClient = Pick<Prisma.TransactionClient, "$queryRaw">;

/**
 * CTE #1 — seluruh pohon event (PROJECT §5.A).
 * Root: parent_id IS NULL. depth jalur, path array, join users untuk name
 * (email tidak diambil — tidak diekspos via organization).
 *
 * Parameter UUID dikirim sebagai ${eventId}::uuid sehingga Prisma menghasilkan
 * $1::uuid (cast eksplisit ke uuid).
 */
export async function getTreeRows(
  eventId: string,
  client: QueryClient = prisma,
): Promise<OrgTreeRow[]> {
  const rows = await client.$queryRaw<
    Array<{
      id: string;
      user_id: string;
      name: string;
      role: string;
      parent_id: string | null;
      title: string | null;
      status: string;
      depth: number;
    }>
  >`
    WITH RECURSIVE tree AS (
      SELECT
        em.id,
        em.user_id,
        u.name,
        em.role,
        em.parent_id,
        em.title,
        em.status,
        0 AS depth,
        ARRAY[em.id] AS path
      FROM event_members em
      JOIN users u ON u.id = em.user_id
      WHERE em.event_id = ${eventId}::uuid
        AND em.parent_id IS NULL

      UNION ALL

      SELECT
        em.id,
        em.user_id,
        u.name,
        em.role,
        em.parent_id,
        em.title,
        em.status,
        tree.depth + 1,
        tree.path || em.id
      FROM event_members em
      JOIN users u ON u.id = em.user_id
      JOIN tree ON tree.id = em.parent_id
      WHERE em.event_id = ${eventId}::uuid
    )
    SELECT
      id,
      user_id,
      name,
      role,
      parent_id,
      title,
      status,
      depth
    FROM tree
    ORDER BY path;
  `;

  // Email sengaja tidak dibaca/dikembalikan: respons pohon & daftar anggota
  // tidak mengekspos email anggota kepada semua anggota aktif (lihat asumsi
  // Phase 7 di README.md). Email hanya tersedia pada profil sendiri
  // (GET /auth/me) dan alur undangan (server-side binding invitation.email).
  return rows.map((r) => ({
    id: r.id,
    userId: r.user_id,
    name: r.name,
    role: r.role as OrgTreeRow["role"],
    parentId: r.parent_id,
    title: r.title,
    status: r.status as OrgTreeRow["status"],
    depth: r.depth,
  }));
}

/**
 * CTE #2 — semua id dalam subtree (termasuk member itu sendiri).
 */
export async function getSubtreeIds(
  eventId: string,
  memberId: string,
  client: QueryClient = prisma,
): Promise<string[]> {
  const rows = await client.$queryRaw<
    Array<{ id: string }>
  >`
    WITH RECURSIVE subtree AS (
      SELECT id
      FROM event_members
      WHERE event_id = ${eventId}::uuid
        AND id = ${memberId}::uuid

      UNION ALL

      SELECT em.id
      FROM event_members em
      JOIN subtree ON subtree.id = em.parent_id
      WHERE em.event_id = ${eventId}::uuid
    )
    SELECT id FROM subtree;
  `;

  return (rows as unknown as Array<{ id: string }>).map((r) => r.id);
}

/**
 * Ambil satu member beserta user (name only; email tidak diekspos via organization).
 */
export async function getMemberWithUser(
  eventId: string,
  memberId: string,
) {
  return prisma.eventMember.findFirst({
    where: { id: memberId, eventId },
    select: {
      id: true,
      eventId: true,
      userId: true,
      role: true,
      status: true,
      parentId: true,
      title: true,
      joinedAt: true,
      createdAt: true,
      updatedAt: true,
      user: {
        select: { id: true, name: true },
      },
    },
  });
}
