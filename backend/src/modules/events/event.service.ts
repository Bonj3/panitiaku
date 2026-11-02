import { randomBytes } from 'node:crypto';
import { prisma } from '../../config/database.js';
import { ConflictError, ForbiddenError, NotFoundError } from '../../shared/errors/app-error.js';
import { slugify } from '../../shared/utils/slugify.js';
import { cancelTransactionsOnClose } from '../finance/finance.service.js';
import { writeAudit } from '../audit/audit.service.js';
import type { CreateEventInput, UpdateEventInput } from './event.validator.js';

export interface EventDetail {
  id: string;
  name: string;
  slug: string;
  status: 'OPEN' | 'CLOSED';
}

export interface EventMembershipRow {
  id: string;
  eventId: string;
  userId: string;
  role: 'EVENT_CHAIR' | 'DIVISION_LEADER' | 'MEMBER';
  status: 'ACTIVE' | 'INACTIVE';
}

const EVENT_SELECT = {
  id: true,
  name: true,
  slug: true,
  status: true,
} as const;

const MEMBERSHIP_SELECT = {
  id: true,
  eventId: true,
  userId: true,
  role: true,
  status: true,
} as const;

function toEventDetail(event: {
  id: string;
  name: string;
  slug: string;
  status: string;
}): EventDetail {
  return {
    id: event.id,
    name: event.name,
    slug: event.slug,
    status: event.status as 'OPEN' | 'CLOSED',
  };
}

function toMembershipRow(
  membership: {
    id: string;
    eventId: string;
    userId: string;
    role: string;
    status: string;
  },
  event: EventDetail
): EventMembershipRow & { event: EventDetail } {
  return {
    id: membership.id,
    eventId: membership.eventId,
    userId: membership.userId,
    role: membership.role as 'EVENT_CHAIR' | 'DIVISION_LEADER' | 'MEMBER',
    status: membership.status as 'ACTIVE' | 'INACTIVE',
    event,
  };
}

/**
 * Buat event + membership root (Event Chair) secara ATOMIK dalam satu
 * Prisma $transaction. Tidak ada event yang tersimpan tanpa root chair,
 * dan sebaliknya.
 */
export async function createEvent(
  userId: string,
  input: CreateEventInput
): Promise<{ event: EventDetail; membership: EventMembershipRow & { event: EventDetail } }> {
  const name = input.name;
  let slug: string;

  if (input.slug) {
    // Pakai slug apa adanya; bentrok ditangkap sebagai P2002 dari unique
    // constraint `events_slug_key` di bawah.
    slug = input.slug;
  } else {
    slug = slugify(name);
    // Coba suffix acak 6 hex maksimal 3 kali jika slug dasar sudah dipakai.
    for (let attempt = 0; attempt < 3; attempt++) {
      const existing = await prisma.event.findUnique({ where: { slug } });
      if (!existing) break;
      slug = `${slug}-${randomBytes(3).toString('hex')}`;
    }
    const stillExists = await prisma.event.findUnique({ where: { slug } });
    if (stillExists) {
      throw new ConflictError('Slug sudah dipakai');
    }
  }

  try {
    return await prisma.$transaction(async (tx) => {
      const event = await tx.event.create({
        data: {
          name,
          slug,
          description: input.description ?? null,
          createdById: userId,
        },
        select: EVENT_SELECT,
      });

      // Root chair wajib ada (parentId null). Constraint DB
      // `event_members_chair_is_root` memaksa EVENT_CHAIR selalu root.
      const membership = await tx.eventMember.create({
        data: {
          eventId: event.id,
          userId,
          role: 'EVENT_CHAIR',
          parentId: null,
          title: 'Ketua',
          status: 'ACTIVE',
        },
        select: MEMBERSHIP_SELECT,
      });

      const eventDetail = toEventDetail(event);
      await writeAudit(tx, {
        eventId: event.id,
        actorId: membership.id,
        action: 'event.create',
        entityType: 'event',
        entityId: event.id,
        metadata: { name, slug: event.slug },
      });
      return {
        event: eventDetail,
        membership: toMembershipRow(membership, eventDetail),
      };
    });
  } catch (err) {
    const prismaErr = err as { code?: string; meta?: unknown };
    // P2002 = unique constraint violation. Di createEvent hanya slug pada
    // events yang bersifat unique dan dapat bentrok (eventMember (userId,
    // eventId) tidak mungkin bentrok untuk event yang baru dibuat).
    if (prismaErr.code === 'P2002') {
      throw new ConflictError('Slug sudah dipakai');
    }
    throw err;
  }
}

/**
 * Detail event + ringkasan membership pengguna yang login (sudah divalidasi
 * aktif oleh middleware eventMembership, dilewatkan dari controller).
 * Tidak ada query ulang membership di sini.
 */
export async function getEventDetail(
  eventId: string,
  membership: EventMembershipRow & { event?: EventDetail }
): Promise<{ event: EventDetail; membership: EventMembershipRow & { event: EventDetail } }> {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: EVENT_SELECT,
  });
  if (!event) {
    throw new NotFoundError('Event tidak ditemukan');
  }

  const eventDetail = toEventDetail(event);
  return {
    event: eventDetail,
    membership: toMembershipRow(membership, eventDetail),
  };
}

export async function updateEvent(
  eventId: string,
  actorMembershipId: string,
  input: UpdateEventInput,
): Promise<EventDetail> {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.event.findUnique({
      where: { id: eventId },
      select: { id: true, name: true, slug: true, description: true },
    });
    if (!existing) {
      throw new NotFoundError('Event tidak ditemukan');
    }

    const data: { name?: string; description?: string | null } = {};
    const changed: string[] = [];
    if (input.name !== undefined) {
      data.name = input.name;
      if (input.name !== existing.name) changed.push('name');
    }
    if (input.description !== undefined) {
      data.description = input.description;
      if (input.description !== existing.description) changed.push('description');
    }

    const updated = await tx.event.update({
      where: { id: eventId },
      data,
      select: EVENT_SELECT,
    });

    await writeAudit(tx, {
      eventId,
      actorId: actorMembershipId,
      action: 'event.update',
      entityType: 'event',
      entityId: eventId,
      metadata: { fields: changed },
    });

    return toEventDetail(updated);
  });
}

/**
 * Tutup event (status OPEN → CLOSED). updateMany bersyarat sehingga status
 * tidak pernah ditimpa bila event sudah CLOSED; count 0 berarti event
 * tidak ada atau sudah ditutup → Conflict 409.
 *
 * TODO Phase 5 (BR-15): dalam transaksi $transaction yang sama, auto-cancel
 * transaksi keuangan dengan status DRAFT/SUBMITTED/APPROVED milik event ini
 * (tandai CANCELLED + catat alasan penutupan) sebelum commit.
 */
export const eventService = {
  createEvent,
  getEventDetail,
  updateEvent,
  closeEvent,
};

export async function closeEvent(
  eventId: string,
  actorMembershipId: string
): Promise<{ cancelledCount: number }> {
  const result = await prisma.$transaction(async (tx) => {
    // Lock event dulu sebelum apapun (urutan lock konsisten dengan finance).
    await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM events WHERE id = ${eventId}::uuid FOR UPDATE;
    `;

    // Baca status event setelah lock.
    const event = await tx.event.findFirst({
      where: { id: eventId },
      select: { id: true, status: true },
    });
    if (!event) {
      throw new NotFoundError('Event tidak ditemukan');
    }
    if (event.status === 'CLOSED') {
      throw new ConflictError('Event sudah ditutup');
    }

    // Re-baca aktor dari DB di dalam transaksi: role/status bisa berubah
    // setelah middleware berjalan. Wajib ACTIVE dan EVENT_CHAIR.
    const actor = await tx.eventMember.findFirst({
      where: { id: actorMembershipId, eventId },
      select: { id: true, role: true, status: true },
    });
    if (!actor || actor.status !== 'ACTIVE') {
      throw new ForbiddenError('Keanggotaan Anda tidak aktif pada event ini');
    }
    if (actor.role !== 'EVENT_CHAIR') {
      throw new ForbiddenError('Hanya Ketua Event yang boleh menutup event');
    }

    await tx.event.update({
      where: { id: eventId },
      data: { status: 'CLOSED', closedAt: new Date() },
    });

    // BR-15: auto-cancel transaksi DRAFT/SUBMITTED/APPROVED dalam transaction
    // yang sama. PAID/REJECTED/CANCELLED tidak berubah; ledger tidak berubah.
    const cancelledCount = await cancelTransactionsOnClose(eventId, actorMembershipId, tx);

    await writeAudit(tx, {
      eventId,
      actorId: actorMembershipId,
      action: 'event.close',
      entityType: 'event',
      entityId: eventId,
      metadata: { cancelledCount },
    });

    return { cancelledCount };
  });
  return result;
}
