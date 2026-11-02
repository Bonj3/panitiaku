import { prisma } from "../../config/database.js";
import {
  ConflictError,
  ForbiddenError,
  GoneError,
  NotFoundError,
  UnprocessableError,
} from "../../shared/errors/app-error.js";
import { generateOpaqueToken, hashToken } from "../../shared/utils/token.js";
import { writeAudit } from "../audit/audit.service.js";
import type { AuthenticatedUser, EventMembership } from "../../shared/types/http.js";
import type {
  CreateInvitationResult,
  InvitationWithInviter,
  PaginatedInvitations,
  PublicInvitationDetail,
} from "./invitation.types.js";
import {
  type CreateInvitationInput,
  type ListInvitationsQuery,
} from "./invitation.validator.js";
import {
  getSubtreeIds,
  isInSubtree,
} from "../organization/organization.service.js";

const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Hasil expireStale per undangan: status baru dan apakah ada baris yang berubah.
 */
interface ExpireStaleResult {
  id: string;
  status: "EXPIRED";
  changed: boolean;
}

/**
 * Tandai undangan PENDING yang sudah lewat expiresAt menjadi EXPIRED secara
 * atomik per baris (conditional update status='PENDING' agar tidak menimpa
 * status final yang baru saja ditetapkan oleh accept/revoke), serta tulis
 * audit `invitation.expire` untuk setiap baris yang berubah.
 *
 * Lock ordering konsisten: event (jika eventId diberikan) dulu, baru
 * invitation. Jika eventId tidak diberikan (public lazy expiry), locking
 * dilakukan per invitation melalui conditional update di dalam transaksi.
 *
 * Tidak ada audit bila tidak ada perubahan.
 */
export async function expireStale(eventId?: string): Promise<ExpireStaleResult[]> {
  const now = new Date();
  const results: ExpireStaleResult[] = [];

  // Ambil daftar kandidat terlebih dahulu, urutkan (eventId, id) agar urutan
  // lock event deterministik dan hindari deadlock antar transaksi.
  const candidates = await prisma.invitation.findMany({
    where: {
      status: "PENDING",
      expiresAt: { lt: now },
      ...(eventId ? { eventId } : {}),
    },
    select: { id: true, eventId: true, invitedById: true },
    orderBy: [{ eventId: "asc" }, { id: "asc" }],
  });

  // Setiap undangan diproses dalam transaksi tersendiri dengan lock event
  // dulu, baru invitation FOR UPDATE. Tidak ada satu transaksi yang kunci
  // banyak event sekaligus.
  for (const inv of candidates) {
    const changed = await prisma.$transaction(async (tx) => {
      // Lock baris event dulu (urutan konsisten dengan create/accept/revoke:
      // event dulu, invitation setelahnya).
      await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM events WHERE id = ${inv.eventId}::uuid FOR UPDATE;
      `;

      // Update bersyarat: hanya ubah bila masih PENDING (antisipasi accept
      // yang menang lebih dulu dalam race).
      const updated = await tx.invitation.updateMany({
        where: { id: inv.id, status: "PENDING" },
        data: { status: "EXPIRED" },
      });
      if (updated.count !== 1) return false;

      await writeAudit(tx, {
        eventId: inv.eventId,
        actorId: inv.invitedById,
        action: 'invitation.expire',
        entityType: 'invitation',
        entityId: inv.id,
        metadata: { trigger: 'automatic_ttl' },
      });
      return true;
    });

    if (changed) {
      results.push({ id: inv.id, status: "EXPIRED", changed: true });
    }
  }

  return results;
}

function toInvitationWithInviter(inv: {
  id: string;
  eventId: string;
  email: string;
  role: string;
  status: string;
  parentId: string | null;
  invitedById: string;
  acceptedById: string | null;
  acceptedAt: Date | null;
  revokedAt: Date | null;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
  invitedBy: {
    id: string;
    userId: string;
    role: string;
    status: string;
    user: { name: string; email: string };
  } | null;
}): InvitationWithInviter {
  return {
    id: inv.id,
    eventId: inv.eventId,
    email: inv.email,
    role: inv.role as "DIVISION_LEADER" | "MEMBER",
    status: inv.status as "PENDING" | "ACCEPTED" | "REVOKED" | "EXPIRED",
    parentId: inv.parentId,
    invitedById: inv.invitedById,
    acceptedById: inv.acceptedById,
    acceptedAt: inv.acceptedAt,
    revokedAt: inv.revokedAt,
    expiresAt: inv.expiresAt,
    createdAt: inv.createdAt,
    updatedAt: inv.updatedAt,
    invitedBy: inv.invitedBy
      ? {
          id: inv.invitedBy.id,
          userId: inv.invitedBy.userId,
          name: inv.invitedBy.user.name,
          email: inv.invitedBy.user.email,
          role: inv.invitedBy.role,
          status: inv.invitedBy.status,
        }
      : null,
  };
}

/**
 * POST /events/:eventId/invitations — buat undangan.
 */
export async function createInvitation(
  eventId: string,
  actor: EventMembership,
  input: CreateInvitationInput,
): Promise<CreateInvitationResult> {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { id: true, status: true },
  });
  if (!event) {
    throw new NotFoundError("Event tidak ditemukan");
  }
  if (event.status !== "OPEN") {
    throw new ConflictError("Event sudah ditutup");
  }

  // OD-3a: role DIVISION_LEADER hanya boleh dibuat oleh EVENT_CHAIR.
  if (input.role === "DIVISION_LEADER" && actor.role !== "EVENT_CHAIR") {
    throw new ForbiddenError(
      "Hanya Ketua Event yang dapat mengundang Division Leader",
    );
  }
  // DIVISION_LEADER hanya boleh mengundang MEMBER.
  if (actor.role === "DIVISION_LEADER" && input.role !== "MEMBER") {
    throw new ForbiddenError(
      "Division Leader hanya dapat mengundang Member",
    );
  }

  // Parent harus member ACTIVE di event yang sama.
  const parent = await prisma.eventMember.findFirst({
    where: { id: input.parentId, eventId },
    select: { id: true, userId: true, role: true, status: true },
  });
  if (!parent) {
    throw new NotFoundError("Parent anggota tidak ditemukan pada event ini");
  }
  if (parent.status !== "ACTIVE") {
    throw new UnprocessableError("Parent anggota harus status ACTIVE");
  }
  // Bila actor DIVISION_LEADER, parent harus berada dalam subtree actor.
  if (actor.role === "DIVISION_LEADER") {
    if (!(await isInSubtree(eventId, actor.id, parent.id))) {
      throw new ForbiddenError(
        "Parent anggota harus berada dalam subtree Anda",
      );
    }
  }

  // Email: membership ACTIVE sudah ada → 409. INACTIVE boleh diundang.
  const existingUser = await prisma.user.findFirst({
    where: { email: input.email },
    select: { id: true },
  });
  if (existingUser) {
    const existingMember = await prisma.eventMember.findFirst({
      where: { eventId, userId: existingUser.id, status: "ACTIVE" },
      select: { id: true },
    });
    if (existingMember) {
      throw new ConflictError(
        "Email sudah menjadi anggota aktif event ini",
      );
    }
  }

  const token = generateOpaqueToken();
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);

  let invitation;
  try {
    invitation = await prisma.$transaction(async (tx) => {
      // BR-14: lock baris event lebih dulu agar pembuatan undangan
      // terserialisasi dengan close event (dan dengan move struktur, yang
      // juga mengunci baris event). Cek status di dalam transaksi.
      const eventRows = await tx.$queryRaw<
        Array<{ id: string; status: string }>
      >`
        SELECT id, status FROM events WHERE id = ${eventId}::uuid FOR UPDATE;
      `;
      const lockedEvent = eventRows[0];
      if (!lockedEvent) {
        throw new NotFoundError("Event tidak ditemukan");
      }
      if (lockedEvent.status !== "OPEN") {
        throw new ConflictError("Event sudah ditutup");
      }

      // Re-baca aktor: role/status bisa berubah setelah middleware berjalan.
      const actorNow = await tx.eventMember.findFirst({
        where: { id: actor.id, eventId },
        select: { id: true, role: true, status: true },
      });
      if (!actorNow || actorNow.status !== "ACTIVE") {
        throw new ForbiddenError("Keanggotaan Anda tidak aktif pada event ini");
      }
      if (input.role === "DIVISION_LEADER" && actorNow.role !== "EVENT_CHAIR") {
        throw new ForbiddenError(
          "Hanya Ketua Event yang dapat mengundang Division Leader",
        );
      }
      if (actorNow.role === "DIVISION_LEADER" && input.role !== "MEMBER") {
        throw new ForbiddenError("Division Leader hanya dapat mengundang Member");
      }
      if (actorNow.role === "MEMBER") {
        throw new ForbiddenError("Role Anda tidak diizinkan mengundang");
      }

      // Re-validasi parent setelah lock (status/move bisa berubah sebelum lock).
      const parentNow = await tx.eventMember.findFirst({
        where: { id: input.parentId, eventId },
        select: { id: true, status: true },
      });
      if (!parentNow) {
        throw new NotFoundError(
          "Parent anggota tidak ditemukan pada event ini",
        );
      }
      if (parentNow.status !== "ACTIVE") {
        throw new UnprocessableError("Parent anggota harus status ACTIVE");
      }
      if (
        actorNow.role === "DIVISION_LEADER" &&
        !(await isInSubtree(eventId, actorNow.id, parentNow.id, tx))
      ) {
        throw new ForbiddenError(
          "Parent anggota harus berada dalam subtree Anda",
        );
      }

      // BR-05: re-check email belum menjadi anggota ACTIVE SETELAH lock event.
      // Pemeriksaan awal di luar transaksi bisa balapan dengan accept lain.
      const existingUserNow = await tx.user.findFirst({
        where: { email: input.email },
        select: { id: true },
      });
      if (existingUserNow) {
        const existingMemberNow = await tx.eventMember.findFirst({
          where: { eventId, userId: existingUserNow.id, status: "ACTIVE" },
          select: { id: true },
        });
        if (existingMemberNow) {
          throw new ConflictError(
            "Email sudah menjadi anggota aktif event ini",
          );
        }
      }

      const inv = await tx.invitation.create({
        data: {
          eventId,
          email: input.email,
          role: input.role,
          parentId: input.parentId,
          invitedById: actor.id,
          status: "PENDING",
          tokenHash,
          expiresAt,
        },
        select: {
          id: true,
          eventId: true,
          email: true,
          role: true,
          status: true,
          parentId: true,
          invitedById: true,
          expiresAt: true,
          createdAt: true,
        },
      });

      await writeAudit(tx, {
        eventId,
        actorId: actor.id,
        action: 'invitation.create',
        entityType: 'invitation',
        entityId: inv.id,
        metadata: { role: input.role, parentId: input.parentId },
      });

      return inv;
    });
  } catch (err) {
    const prismaErr = err as { code?: string; meta?: unknown };
    // P2002 (Prisma) / 23505 (PostgreSQL unique violation) pada
    // partial unique index invitations_one_pending_per_event_email_idx.
    if (prismaErr.code === "P2002" || prismaErr.code === "23505") {
      throw new ConflictError("Sudah ada undangan PENDING untuk email ini");
    }
    throw err;
  }

  return {
    invitation: {
      id: invitation.id,
      eventId: invitation.eventId,
      email: invitation.email,
      role: invitation.role as "DIVISION_LEADER" | "MEMBER",
      status: invitation.status as "PENDING",
      parentId: invitation.parentId,
      invitedById: invitation.invitedById,
      expiresAt: invitation.expiresAt,
      createdAt: invitation.createdAt,
    },
    token, // plaintext HANYA di respons ini, tidak disimpan/di-log
  };
}

/**
 * GET /events/:eventId/invitations — daftar undangan dengan pagination + filter.
 */
export async function listInvitations(
  eventId: string,
  actor: EventMembership,
  query: ListInvitationsQuery,
): Promise<PaginatedInvitations> {
  await expireStale(eventId);

  const page = Math.max(1, query.page);
  const perPage = Math.min(100, Math.max(1, query.perPage));
  const skip = (page - 1) * perPage;

  const where: Record<string, unknown> = { eventId };
  if (query.status) {
    where.status = query.status;
  }

  // DIVISION_LEADER hanya melihat undangan yang parentId ∈ subtree miliknya.
  if (actor.role === "DIVISION_LEADER") {
    const subtreeIds = await getSubtreeIds(eventId, actor.id);
    where.parentId = { in: subtreeIds };
  }

  const [items, total] = await Promise.all([
    prisma.invitation.findMany({
      where,
      select: {
        id: true,
        eventId: true,
        email: true,
        role: true,
        status: true,
        parentId: true,
        invitedById: true,
        acceptedById: true,
        acceptedAt: true,
        revokedAt: true,
        expiresAt: true,
        createdAt: true,
        updatedAt: true,
        invitedBy: {
          select: {
            id: true,
            userId: true,
            role: true,
            status: true,
            user: { select: { name: true, email: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
      skip,
      take: perPage,
    }),
    prisma.invitation.count({ where }),
  ]);

  const totalPages = Math.ceil(total / perPage);

  return {
    items: items.map((inv) =>
      toInvitationWithInviter(
        inv as unknown as Parameters<typeof toInvitationWithInviter>[0],
      ),
    ),
    meta: { page, perPage, total, totalPages },
  };
}

/**
 * GET /api/v1/invitations/:token (publik) — detail undangan tanpa email/PII.
 */
export async function getPublicDetail(
  token: string,
): Promise<PublicInvitationDetail> {
  // Lazy expiry untuk undangan PENDING yang sudah lewat expiresAt.
  // Tidak ada actor sesi pada permintaan publik; pakai invitedById sebagai
  // actor terkait (yang memulai lifecycle undangan), dengan metadata
  // trigger:'automatic_ttl' agar jelas ini sistem-trigger, bukan aksi manual
  // inviter. Tidak pernah log email/token/tokenHash.
  await expireStale();

  const tokenHash = hashToken(token);
  const invitation = await prisma.invitation.findUnique({
    where: { tokenHash },
    select: {
      id: true,
      status: true,
      expiresAt: true,
      role: true,
      eventId: true,
      invitedById: true,
      event: { select: { name: true, slug: true, status: true } },
    },
  });
  if (!invitation) {
    throw new NotFoundError("Undangan tidak ditemukan");
  }

  // Bila undangan ini baru saja expired oleh expireStale di atas (atau oleh
  // request paralel), tandai dan berikan Gone.
  if (invitation.status !== "PENDING") {
    throw new GoneError("Undangan sudah tidak berlaku");
  }

  if (invitation.expiresAt < new Date()) {
    await prisma.$transaction(async (tx) => {
      // Lock baris event dulu (urutan konsisten), baru invitation.
      await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM events WHERE id = ${invitation.eventId}::uuid FOR UPDATE;
      `;

      const updated = await tx.invitation.updateMany({
        where: { id: invitation.id, status: "PENDING" },
        data: { status: "EXPIRED" },
      });
      if (updated.count !== 1) {
        // Diganti status final oleh request lain → Gone tanpa audit tambahan.
        return;
      }

      await writeAudit(tx, {
        eventId: invitation.eventId,
        actorId: invitation.invitedById,
        action: 'invitation.expire',
        entityType: 'invitation',
        entityId: invitation.id,
        metadata: { trigger: 'automatic_ttl' },
      });
    });

    // commit berhasil; baru throw di luar transaksi (jangan rollback).
    throw new GoneError("Undangan sudah kadaluarsa");
  }

  return {
    eventName: invitation.event.name,
    eventSlug: invitation.event.slug,
    eventStatus: invitation.event.status as "OPEN" | "CLOSED",
    role: invitation.role as "DIVISION_LEADER" | "MEMBER",
    expiresAt: invitation.expiresAt,
  };
}

/**
 * POST /api/v1/invitations/:token/accept — terima undangan, atomik + row lock.
 */
export async function acceptInvitation(
  token: string,
  user: AuthenticatedUser,
): Promise<{
  membership: {
    id: string;
    eventId: string;
    userId: string;
    role: "EVENT_CHAIR" | "DIVISION_LEADER" | "MEMBER";
    status: "ACTIVE" | "INACTIVE";
    parentId: string | null;
    title: string | null;
    event: { id: string; name: string; slug: string; status: "OPEN" | "CLOSED" };
  };
}> {
  // Tandai undangan kedaluwarsa SEBELUM transaksi agar perubahan status
  // EXPIRED benar-benar tersimpan (error di dalam transaksi akan rollback).
  await expireStale();

  const tokenHash = hashToken(token);
  const pre = await prisma.invitation.findUnique({
    where: { tokenHash },
    select: { id: true, eventId: true },
  });
  if (!pre) {
    throw new NotFoundError("Undangan tidak ditemukan");
  }

  /**
   * Hasil cabang di dalam transaksi accept: expired (perlu Gone di luar tx
   * agar commit tidak di-rollback) atau accepted (membership siap dikembalikan).
   */
  type AcceptOutcome =
    | { kind: "expired" }
    | {
        kind: "accepted";
        membership: {
          id: string;
          eventId: string;
          userId: string;
          role: "EVENT_CHAIR" | "DIVISION_LEADER" | "MEMBER";
          status: "ACTIVE" | "INACTIVE";
          parentId: string | null;
          title: string | null;
          event: { id: string; name: string; slug: string; status: "OPEN" | "CLOSED" };
        };
      };

  const outcome: AcceptOutcome = await prisma.$transaction(async (tx) => {
    // Urutan lock konsisten dengan create/revoke: event dulu, lalu invitation.
    // Ini menutup race accept vs close-event dan revoke vs accept.
    await tx.$queryRaw`
      SELECT id FROM events WHERE id = ${pre.eventId}::uuid FOR UPDATE;
    `;

    const locked = await tx.$queryRaw<
      Array<{
        id: string;
        event_id: string;
        email: string;
        role: string;
        status: string;
        parent_id: string | null;
        invited_by: string;
        "expiresAt": Date;
      }>
    >`
      SELECT id, event_id, email, role, status, parent_id, invited_by, "expiresAt"
      FROM invitations
      WHERE id = ${pre.id}::uuid
      FOR UPDATE;
    `;
    const invitation = locked[0];
    if (!invitation) {
      throw new NotFoundError("Undangan tidak ditemukan");
    }

    const now = new Date();

    if (invitation.status !== "PENDING") {
      // Sudah final (EXPIRED/ACCEPTED/REVOKED) oleh proses lain; tidak ada
      // perubahan status di sini, jadi tidak perlu audit tambahan.
      throw new GoneError("Undangan sudah tidak berlaku");
    }

    if (invitation.expiresAt < now) {
      // Race: undangan masih PENDING tapi sudah lewat TTL. Tandai EXPIRED +
      // audit di dalam transaksi yang sama (event + invitation sudah terkunci),
      // commit normal, baru throw Gone di luar tx agar tidak rollback.
      const updated = await tx.invitation.updateMany({
        where: { id: invitation.id, status: "PENDING" },
        data: { status: "EXPIRED" },
      });
      if (updated.count === 1) {
        await writeAudit(tx, {
          eventId: invitation.event_id,
          actorId: invitation.invited_by,
          action: 'invitation.expire',
          entityType: 'invitation',
          entityId: invitation.id,
          metadata: { trigger: 'automatic_ttl' },
        });
      }
      return { kind: "expired" };
    }

    const event = await tx.event.findUnique({
      where: { id: invitation.event_id },
      select: { id: true, name: true, slug: true, status: true },
    });
    if (!event) {
      throw new NotFoundError("Event tidak ditemukan");
    }
    if (event.status !== "OPEN") {
      throw new ConflictError("Event sudah ditutup");
    }

    // Email penerima harus cocok (case-insensitive).
    if (invitation.email.toLowerCase() !== user.email.toLowerCase()) {
      throw new ForbiddenError("Undangan bukan untuk akun ini");
    }

    // Re-check inviter masih ACTIVE dan berhak (pakai tx untuk konsistensi).
    const inviter = await tx.eventMember.findFirst({
      where: { id: invitation.invited_by, eventId: invitation.event_id },
      select: { id: true, userId: true, role: true, status: true },
    });
    if (!inviter || inviter.status !== "ACTIVE") {
      throw new ConflictError("Undangan tidak lagi valid");
    }
    // Inviter yang role-nya sudah diturunkan menjadi MEMBER tidak lagi berhak.
    if (inviter.role === "MEMBER") {
      throw new ConflictError("Undangan tidak lagi valid");
    }
    // OD-3a: undangan DIVISION_LEADER hanya sah bila dibuat Chair.
    if (invitation.role === "DIVISION_LEADER" && inviter.role !== "EVENT_CHAIR") {
      throw new ConflictError("Undangan tidak lagi valid");
    }

    // Parent undangan harus masih ACTIVE dan berada dalam event yang sama.
    if (invitation.parent_id === null) {
      throw new ConflictError("Undangan tidak lagi valid");
    }
    const parent = await tx.eventMember.findFirst({
      where: { id: invitation.parent_id, eventId: invitation.event_id },
      select: { id: true, status: true },
    });
    if (!parent || parent.status !== "ACTIVE") {
      throw new ConflictError("Undangan tidak lagi valid");
    }

    // Aturan #5: inviter harus MASIH memiliki permission saat accept.
    // Untuk SEMUA undangan buatan DIVISION_LEADER (termasuk role MEMBER),
    // parent harus masih berada dalam subtree inviter.
    if (
      inviter.role === "DIVISION_LEADER" &&
      !(await isInSubtree(
        invitation.event_id,
        inviter.id,
        invitation.parent_id,
        tx,
      ))
    ) {
      throw new ConflictError("Undangan tidak lagi valid");
    }

    // Cek membership user di event ini.
    const existingMember = await tx.eventMember.findFirst({
      where: { eventId: invitation.event_id, userId: user.id },
      select: { id: true, role: true, status: true },
    });

    let membershipId: string;
    if (existingMember) {
      if (existingMember.status === "ACTIVE") {
        throw new ConflictError("Anda sudah menjadi anggota event ini");
      }
      // Reaktivasi membership INACTIVE.
      await tx.eventMember.update({
        where: { id: existingMember.id },
        data: {
          status: "ACTIVE",
          role: invitation.role as "EVENT_CHAIR" | "DIVISION_LEADER" | "MEMBER",
          parentId: invitation.parent_id,
          joinedAt: now,
        },
      });
      membershipId = existingMember.id;
    } else {
      const created = await tx.eventMember.create({
        data: {
          eventId: invitation.event_id,
          userId: user.id,
          role: invitation.role as "EVENT_CHAIR" | "DIVISION_LEADER" | "MEMBER",
          parentId: invitation.parent_id,
          status: "ACTIVE",
          joinedAt: now,
        },
        select: { id: true },
      });
      membershipId = created.id;
    }

    await tx.invitation.update({
      where: { id: invitation.id },
      data: {
        status: "ACCEPTED",
        acceptedById: user.id,
        acceptedAt: now,
      },
    });

    await writeAudit(tx, {
      eventId: invitation.event_id,
      actorId: membershipId,
      action: 'invitation.accept',
      entityType: 'invitation',
      entityId: invitation.id,
      metadata: { role: invitation.role },
    });

    return {
      kind: "accepted",
      membership: {
        id: membershipId,
        eventId: invitation.event_id,
        userId: user.id,
        role: invitation.role as "EVENT_CHAIR" | "DIVISION_LEADER" | "MEMBER",
        status: "ACTIVE",
        parentId: invitation.parent_id,
        title: null,
        event: {
          id: event.id,
          name: event.name,
          slug: event.slug,
          status: event.status as "OPEN" | "CLOSED",
        },
      },
    };
  });

  if (outcome.kind === "expired") {
    // Commit transaksi sudah berhasil; baru signal expired ke caller agar
    // response 410 tanpa rollback perubahan expire di atas.
    throw new GoneError("Undangan sudah kadaluarsa");
  }
  return { membership: outcome.membership };
}

/**
 * POST /events/:eventId/invitations/:invitationId/revoke — batalkan undangan.
 */
export async function revokeInvitation(
  eventId: string,
  actor: EventMembership,
  invitationId: string,
): Promise<{ invitationId: string; status: "REVOKED" }> {
  await prisma.$transaction(async (tx) => {
    // Lock event lalu invitation (urutan sama dengan create/accept) supaya
    // revoke vs accept terserialisasi dan tidak saling menimpa status.
    await tx.$queryRaw`
      SELECT id FROM events WHERE id = ${eventId}::uuid FOR UPDATE;
    `;

    const rows = await tx.$queryRaw<
      Array<{
        id: string;
        status: string;
        invited_by: string;
        parent_id: string | null;
      }>
    >`
      SELECT id, status, invited_by, parent_id
      FROM invitations
      WHERE id = ${invitationId}::uuid AND event_id = ${eventId}::uuid
      FOR UPDATE;
    `;
    const invitation = rows[0];
    if (!invitation) {
      throw new NotFoundError("Undangan tidak ditemukan");
    }
    if (invitation.status !== "PENDING") {
      throw new ConflictError("Undangan sudah final");
    }

    // Re-baca aktor: role/status bisa berubah (mis. diturunkan jadi MEMBER)
    // setelah middleware berjalan.
    const actorNow = await tx.eventMember.findFirst({
      where: { id: actor.id, eventId },
      select: { id: true, role: true, status: true },
    });
    if (!actorNow || actorNow.status !== "ACTIVE") {
      throw new ForbiddenError("Keanggotaan Anda tidak aktif pada event ini");
    }

    if (actorNow.role === "EVENT_CHAIR") {
      // boleh semua PENDING di event
    } else if (actorNow.role === "DIVISION_LEADER") {
      const isInviter = invitation.invited_by === actorNow.id;
      const parentInSubtree =
        invitation.parent_id !== null &&
        (await isInSubtree(eventId, actorNow.id, invitation.parent_id, tx));
      if (!isInviter && !parentInSubtree) {
        throw new ForbiddenError(
          "Anda tidak berhak membatalkan undangan ini",
        );
      }
    } else {
      throw new ForbiddenError(
        "Role Anda tidak diizinkan membatalkan undangan",
      );
    }

    // Bersyarat: bila accept menang lebih dulu, count = 0 → 409.
    const updated = await tx.invitation.updateMany({
      where: { id: invitationId, status: "PENDING" },
      data: { status: "REVOKED", revokedAt: new Date() },
    });
    if (updated.count !== 1) {
      throw new ConflictError("Undangan sudah final");
    }

    await writeAudit(tx, {
      eventId,
      actorId: actor.id,
      action: 'invitation.revoke',
      entityType: 'invitation',
      entityId: invitationId,
      metadata: { invitedById: invitation.invited_by },
    });
  });

  return { invitationId, status: "REVOKED" };
}
