import { hash } from "@node-rs/argon2";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../src/config/database.js";
import {
  createInvitation,
  acceptInvitation,
  revokeInvitation,
  expireStale,
} from "../src/modules/invitations/invitation.service.js";
import { hashToken } from "../src/shared/utils/token.js";
import {
  ConflictError,
  ForbiddenError,
  GoneError,
  NotFoundError,
  UnprocessableError,
} from "../src/shared/errors/app-error.js";
import type { EventMembership } from "../src/shared/types/http.js";
import type { AuthenticatedUser } from "../src/shared/types/http.js";

const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const createdUserIds: string[] = [];
const createdEventIds: string[] = [];

function email(label: string): string {
  return `ds.${label}.${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
}

async function createUser(opts: { name?: string; email?: string } = {}) {
  const e = opts.email ?? email("user");
  const passwordHash = await hash("password123");
  const user = await prisma.user.create({
    data: { name: opts.name ?? "DS User", email: e, passwordHash },
  });
  createdUserIds.push(user.id);
  return user;
}

async function createEvent(opts: { createdById: string; status?: "OPEN" | "CLOSED" } = { createdById: "" }) {
  const event = await prisma.event.create({
    data: {
      name: "DS Event",
      slug: `ds-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      createdById: opts.createdById,
      status: opts.status ?? "OPEN",
    },
  });
  createdEventIds.push(event.id);
  return event;
}

async function createMembership(opts: {
  eventId: string;
  userId: string;
  role: "EVENT_CHAIR" | "DIVISION_LEADER" | "MEMBER";
  parentId: string | null;
  status?: "ACTIVE" | "INACTIVE";
  title?: string;
}) {
  return prisma.eventMember.create({
    data: {
      eventId: opts.eventId,
      userId: opts.userId,
      role: opts.role,
      parentId: opts.parentId,
      title: opts.title ?? opts.role,
      status: opts.status ?? "ACTIVE",
    },
  });
}

function membershipOf(member: { id: string; eventId: string; userId: string; role: string; status: string }): EventMembership {
  return {
    id: member.id,
    eventId: member.eventId,
    userId: member.userId,
    role: member.role as EventMembership["role"],
    status: member.status as EventMembership["status"],
    event: { id: member.eventId, name: "DS Event", slug: "ds", status: "OPEN" },
  };
}

function userOf(user: { id: string; email: string }): AuthenticatedUser {
  return { id: user.id, email: user.email, name: user.name ?? "DS User" };
}

async function makeInvitation({
  eventId,
  invitedById,
  email,
  role = "MEMBER",
  parentId,
  status = "PENDING",
  expiresAt,
}: {
  eventId: string;
  invitedById: string;
  email: string;
  role?: "DIVISION_LEADER" | "MEMBER";
  parentId: string | null;
  status?: "PENDING" | "ACCEPTED" | "REVOKED" | "EXPIRED";
  expiresAt?: Date;
}) {
  const token = `ds-tok-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const created = await prisma.invitation.create({
    data: {
      eventId,
      email,
      role,
      parentId,
      invitedById,
      status,
      tokenHash: hashToken(token),
      expiresAt: expiresAt ?? new Date(Date.now() + TOKEN_TTL_MS),
    },
    select: { id: true },
  });
  return { id: created.id, token };
}

beforeAll(async () => {
  await prisma.$connect();
});

afterEach(async () => {
  // Bersihkan undangan/anggota dari event uji agar tidak bocor antar test.
  if (createdEventIds.length) {
    await prisma.auditLog.deleteMany({ where: { eventId: { in: createdEventIds } } });
    await prisma.invitation.deleteMany({ where: { eventId: { in: createdEventIds } } });
    await prisma.eventMember.deleteMany({ where: { eventId: { in: createdEventIds } } });
    await prisma.event.deleteMany({ where: { id: { in: createdEventIds } } });
    createdEventIds.length = 0;
  }
  if (createdUserIds.length) {
    await prisma.session.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    createdUserIds.length = 0;
  }
});

// ============================================================================
// createInvitation (direct service) — uncovered branches
// ============================================================================
describe("createInvitation (direct service)", () => {
  it("event tidak ditemukan sebelum transaksi ➜ NOT_FOUND", async () => {
    const chair = await createUser();
    const event = await createEvent({ createdById: chair.id });
    const chairMember = await createMembership({
      eventId: event.id,
      userId: chair.id,
      role: "EVENT_CHAIR",
      parentId: null,
    });

    let err: unknown = null;
    try {
      await createInvitation("00000000-0000-0000-0000-000000000000", membershipOf(chairMember), {
        email: email("x"),
        role: "MEMBER",
        parentId: chairMember.id,
      });
    } catch (e) {
      err = e;
    }
    if (!(err instanceof NotFoundError)) {
      console.error(
        "DS-C1 endpoint=createInvitation (event tidak ada) harapan=NOT_FOUND aktual=" +
          (err instanceof Error ? err.constructor.name : typeof err) +
          " msg=" +
          (err instanceof Error ? err.message : String(err)),
      );
    }
    expect(err).toBeInstanceOf(NotFoundError);
    expect((err as NotFoundError).code).toBe("NOT_FOUND");
  });

  it("DIVISION_LEADER mengundang non-MEMBER ➜ FORBIDDEN", async () => {
    const chair = await createUser();
    const event = await createEvent({ createdById: chair.id });
    const chairMember = await createMembership({
      eventId: event.id,
      userId: chair.id,
      role: "EVENT_CHAIR",
      parentId: null,
    });
    const dlUser = await createUser();
    const dlMember = await createMembership({
      eventId: event.id,
      userId: dlUser.id,
      role: "DIVISION_LEADER",
      parentId: chairMember.id,
    });

    let err: unknown = null;
    try {
      await createInvitation(
        event.id,
        membershipOf(dlMember),
        { email: email("x"), role: "DIVISION_LEADER", parentId: dlMember.id },
      );
    } catch (e) {
      err = e;
    }
    if (!(err instanceof ForbiddenError)) {
      console.error(
        "DS-C2 endpoint=createInvitation (DL undang non-MEMBER) harapan=FORBIDDEN aktual=" +
          (err instanceof Error ? err.constructor.name : typeof err),
      );
    }
    expect(err).toBeInstanceOf(ForbiddenError);
    expect((err as ForbiddenError).code).toBe("FORBIDDEN");
  });

  it("event ditutup di dalam transaksi ➜ CONFLICT", async () => {
    const chair = await createUser();
    const event = await createEvent({ createdById: chair.id, status: "CLOSED" });
    const chairMember = await createMembership({
      eventId: event.id,
      userId: chair.id,
      role: "EVENT_CHAIR",
      parentId: null,
    });

    let err: unknown = null;
    try {
      await createInvitation(event.id, membershipOf(chairMember), {
        email: email("x"),
        role: "MEMBER",
        parentId: chairMember.id,
      });
    } catch (e) {
      err = e;
    }
    if (!(err instanceof ConflictError)) {
      console.error(
        "DS-C3 endpoint=createInvitation (event ditutup) harapan=CONFLICT aktual=" +
          (err instanceof Error ? err.constructor.name : typeof err),
      );
    }
    expect(err).toBeInstanceOf(ConflictError);
    expect((err as ConflictError).code).toBe("CONFLICT");
  });

  it("actor INACTIVE di dalam transaksi ➜ FORBIDDEN", async () => {
    const chair = await createUser();
    const event = await createEvent({ createdById: chair.id });
    // Chair yang akan di-nonaktifkan (melewati semua validasi di luar tx;
    // cek status aktif hanya ada di dalam transaksi).
    const chairMember = await createMembership({
      eventId: event.id,
      userId: chair.id,
      role: "EVENT_CHAIR",
      parentId: null,
      status: "INACTIVE",
    });
    const memberUser = await createUser();
    const member = await createMembership({
      eventId: event.id,
      userId: memberUser.id,
      role: "MEMBER",
      parentId: chairMember.id,
      status: "ACTIVE",
    });

    let err: unknown = null;
    try {
      await createInvitation(event.id, membershipOf(chairMember), {
        email: email("x"),
        role: "MEMBER",
        parentId: member.id,
      });
    } catch (e) {
      err = e;
    }
    if (!(err instanceof ForbiddenError)) {
      console.error(
        "DS-C4 endpoint=createInvitation (actor INACTIVE) harapan=FORBIDDEN aktual=" +
          (err instanceof Error ? err.constructor.name : typeof err),
      );
    }
    expect(err).toBeInstanceOf(ForbiddenError);
  });

  it("MEMBER mencoba mengundang ➜ FORBIDDEN", async () => {
    const chair = await createUser();
    const event = await createEvent({ createdById: chair.id });
    const chairMember = await createMembership({
      eventId: event.id,
      userId: chair.id,
      role: "EVENT_CHAIR",
      parentId: null,
    });
    const memUser = await createUser();
    const memMember = await createMembership({
      eventId: event.id,
      userId: memUser.id,
      role: "MEMBER",
      parentId: chairMember.id,
    });

    let err: unknown = null;
    try {
      await createInvitation(event.id, membershipOf(memMember), {
        email: email("x"),
        role: "MEMBER",
        parentId: chairMember.id,
      });
    } catch (e) {
      err = e;
    }
    if (!(err instanceof ForbiddenError)) {
      console.error(
        "DS-C5 endpoint=createInvitation (MEMBER undang) harapan=FORBIDDEN aktual=" +
          (err instanceof Error ? err.constructor.name : typeof err),
      );
    }
    expect(err).toBeInstanceOf(ForbiddenError);
  });

  it("parent tidak ditemukan di dalam transaksi ➜ NOT_FOUND", async () => {
    const chair = await createUser();
    const event = await createEvent({ createdById: chair.id });
    const chairMember = await createMembership({
      eventId: event.id,
      userId: chair.id,
      role: "EVENT_CHAIR",
      parentId: null,
    });

    let err: unknown = null;
    try {
      await createInvitation(event.id, membershipOf(chairMember), {
        email: email("x"),
        role: "MEMBER",
        parentId: "00000000-0000-0000-0000-000000000000",
      });
    } catch (e) {
      err = e;
    }
    if (!(err instanceof NotFoundError)) {
      console.error(
        "DS-C6 endpoint=createInvitation (parent tidak ada) harapan=NOT_FOUND aktual=" +
          (err instanceof Error ? err.constructor.name : typeof err),
      );
    }
    expect(err).toBeInstanceOf(NotFoundError);
    expect((err as NotFoundError).code).toBe("NOT_FOUND");
  });

  it("parent INACTIVE di dalam transaksi ➜ UNPROCESSABLE", async () => {
    const chair = await createUser();
    const event = await createEvent({ createdById: chair.id });
    const chairMember = await createMembership({
      eventId: event.id,
      userId: chair.id,
      role: "EVENT_CHAIR",
      parentId: null,
    });
    const inactUser = await createUser();
    const inactMember = await createMembership({
      eventId: event.id,
      userId: inactUser.id,
      role: "MEMBER",
      parentId: chairMember.id,
      status: "INACTIVE",
    });

    let err: unknown = null;
    try {
      await createInvitation(event.id, membershipOf(chairMember), {
        email: email("x"),
        role: "MEMBER",
        parentId: inactMember.id,
      });
    } catch (e) {
      err = e;
    }
    if (!(err instanceof UnprocessableError)) {
      console.error(
        "DS-C7 endpoint=createInvitation (parent INACTIVE) harapan=UNPROCESSABLE aktual=" +
          (err instanceof Error ? err.constructor.name : typeof err),
      );
    }
    expect(err).toBeInstanceOf(UnprocessableError);
    expect((err as UnprocessableError).code).toBe("UNPROCESSABLE");
  });

  it("DIVISION_LEADER parent di luar subtree di dalam transaksi ➜ FORBIDDEN", async () => {
    const chair = await createUser();
    const event = await createEvent({ createdById: chair.id });
    const chairMember = await createMembership({
      eventId: event.id,
      userId: chair.id,
      role: "EVENT_CHAIR",
      parentId: null,
    });
    const dlAUser = await createUser();
    const dlAMember = await createMembership({
      eventId: event.id,
      userId: dlAUser.id,
      role: "DIVISION_LEADER",
      parentId: chairMember.id,
    });
    const dlBUser = await createUser();
    const dlBMember = await createMembership({
      eventId: event.id,
      userId: dlBUser.id,
      role: "DIVISION_LEADER",
      parentId: chairMember.id,
    });
    const memBUser = await createUser();
    const memBMember = await createMembership({
      eventId: event.id,
      userId: memBUser.id,
      role: "MEMBER",
      parentId: dlBMember.id,
    });

    // DL A undang dengan parent = memberB (di subtree DL B, bukan DL A)
    let err: unknown = null;
    try {
      await createInvitation(event.id, membershipOf(dlAMember), {
        email: email("x"),
        role: "MEMBER",
        parentId: memBMember.id,
      });
    } catch (e) {
      err = e;
    }
    if (!(err instanceof ForbiddenError)) {
      console.error(
        "DS-C8 endpoint=createInvitation (DL parent luar subtree) harapan=FORBIDDEN aktual=" +
          (err instanceof Error ? err.constructor.name : typeof err),
      );
    }
    expect(err).toBeInstanceOf(ForbiddenError);
  });

  it("email sudah anggota ACTIVE (re-check di dalam transaksi) ➜ CONFLICT", async () => {
    const chair = await createUser();
    const event = await createEvent({ createdById: chair.id });
    const chairMember = await createMembership({
      eventId: event.id,
      userId: chair.id,
      role: "EVENT_CHAIR",
      parentId: null,
    });
    const existingUser = await createUser({ email: email("active") });
    await createMembership({
      eventId: event.id,
      userId: existingUser.id,
      role: "MEMBER",
      parentId: chairMember.id,
      status: "ACTIVE",
    });

    let err: unknown = null;
    try {
      await createInvitation(event.id, membershipOf(chairMember), {
        email: existingUser.email,
        role: "MEMBER",
        parentId: chairMember.id,
      });
    } catch (e) {
      err = e;
    }
    if (!(err instanceof ConflictError)) {
      console.error(
        "DS-C9 endpoint=createInvitation (email aktif re-check tx) harapan=CONFLICT aktual=" +
          (err instanceof Error ? err.constructor.name : typeof err),
      );
    }
    expect(err).toBeInstanceOf(ConflictError);
    expect((err as ConflictError).code).toBe("CONFLICT");
  });

  it("dua create paralel email sama via service ➜ satu sukses, satu CONFLICT (P2002)", async () => {
    const chair = await createUser();
    const event = await createEvent({ createdById: chair.id });
    const chairMember = await createMembership({
      eventId: event.id,
      userId: chair.id,
      role: "EVENT_CHAIR",
      parentId: null,
    });
    const targetEmail = email("race");

    const results = await Promise.allSettled([
      createInvitation(event.id, membershipOf(chairMember), {
        email: targetEmail,
        role: "MEMBER",
        parentId: chairMember.id,
      }),
      createInvitation(event.id, membershipOf(chairMember), {
        email: targetEmail,
        role: "MEMBER",
        parentId: chairMember.id,
      }),
    ]);

    const fulfilledResults = results.filter((r) => r.status === "fulfilled");
    const rejectedResults = results.filter((r) => r.status === "rejected");
    const conflicts = rejectedResults.filter(
      (r) => (r as PromiseRejectedResult).reason instanceof ConflictError,
    ).length;

    if (fulfilledResults.length !== 1 || conflicts !== 1) {
      console.error(
        "DS-C10 endpoint=createInvitation (P2002 race) harapan=1 sukses+1 CONFLICT aktual=" +
          JSON.stringify({
            fulfilled: fulfilledResults.length,
            rejected: rejectedResults.length,
            conflicts,
          }),
      );
    }
    expect(fulfilledResults.length).toBe(1);
    expect(conflicts).toBe(1);

    // Tepat satu undangan di DB
    const count = await prisma.invitation.count({ where: { eventId: event.id, email: targetEmail } });
    expect(count).toBe(1);
  });
});

// ============================================================================
// acceptInvitation (direct service) — uncovered branches
// ============================================================================
describe("acceptInvitation (direct service)", () => {
  it("token hash tidak cocok undangan apa pun ➜ NOT_FOUND", async () => {
    const user = await createUser({ email: email("acceptor") });
    let err: unknown = null;
    try {
      await acceptInvitation("token_tidak_valid_12345", userOf(user));
    } catch (e) {
      err = e;
    }
    if (!(err instanceof NotFoundError)) {
      console.error(
        "DS-A1 endpoint=acceptInvitation (token tidak ada) harapan=NOT_FOUND aktual=" +
          (err instanceof Error ? err.constructor.name : typeof err),
      );
    }
    expect(err).toBeInstanceOf(NotFoundError);
    expect((err as NotFoundError).code).toBe("NOT_FOUND");
  });

  it("undangan sudah final (ACCEPTED) ➜ GONE", async () => {
    const chair = await createUser();
    const event = await createEvent({ createdById: chair.id });
    const chairMember = await createMembership({
      eventId: event.id,
      userId: chair.id,
      role: "EVENT_CHAIR",
      parentId: null,
    });
    const acceptor = await createUser({ email: email("acc") });
    const inv = await makeInvitation({
      eventId: event.id,
      invitedById: chairMember.id,
      email: acceptor.email,
      role: "MEMBER",
      parentId: chairMember.id,
      status: "ACCEPTED",
    });

    let err: unknown = null;
    try {
      await acceptInvitation(inv.token, userOf(acceptor));
    } catch (e) {
      err = e;
    }
    if (!(err instanceof GoneError)) {
      console.error(
        "DS-A2 endpoint=acceptInvitation (sudah ACCEPTED) harapan=GONE aktual=" +
          (err instanceof Error ? err.constructor.name : typeof err),
      );
    }
    expect(err).toBeInstanceOf(GoneError);
    expect((err as GoneError).code).toBe("GONE");
  });

  it("event sudah ditutup saat accept ➜ CONFLICT", async () => {
    const chair = await createUser();
    const event = await createEvent({ createdById: chair.id, status: "CLOSED" });
    const chairMember = await createMembership({
      eventId: event.id,
      userId: chair.id,
      role: "EVENT_CHAIR",
      parentId: null,
    });
    const acceptor = await createUser({ email: email("acc2") });
    const inv = await makeInvitation({
      eventId: event.id,
      invitedById: chairMember.id,
      email: acceptor.email,
      role: "MEMBER",
      parentId: chairMember.id,
    });

    let err: unknown = null;
    try {
      await acceptInvitation(inv.token, userOf(acceptor));
    } catch (e) {
      err = e;
    }
    if (!(err instanceof ConflictError)) {
      console.error(
        "DS-A3 endpoint=acceptInvitation (event ditutup) harapan=CONFLICT aktual=" +
          (err instanceof Error ? err.constructor.name : typeof err),
      );
    }
    expect(err).toBeInstanceOf(ConflictError);
    expect((err as ConflictError).code).toBe("CONFLICT");
  });

  it("email penerima tidak cocok ➜ FORBIDDEN", async () => {
    const chair = await createUser();
    const event = await createEvent({ createdById: chair.id });
    const chairMember = await createMembership({
      eventId: event.id,
      userId: chair.id,
      role: "EVENT_CHAIR",
      parentId: null,
    });
    const inv = await makeInvitation({
      eventId: event.id,
      invitedById: chairMember.id,
      email: email("target"),
      role: "MEMBER",
      parentId: chairMember.id,
    });
    const otherUser = await createUser({ email: email("other") });

    let err: unknown = null;
    try {
      await acceptInvitation(inv.token, userOf(otherUser));
    } catch (e) {
      err = e;
    }
    if (!(err instanceof ForbiddenError)) {
      console.error(
        "DS-A4 endpoint=acceptInvitation (email tidak cocok) harapan=FORBIDDEN aktual=" +
          (err instanceof Error ? err.constructor.name : typeof err),
      );
    }
    expect(err).toBeInstanceOf(ForbiddenError);
    expect((err as ForbiddenError).code).toBe("FORBIDDEN");
  });

  it("inviter diturunkan menjadi MEMBER ➜ CONFLICT", async () => {
    const chair = await createUser();
    const event = await createEvent({ createdById: chair.id });
    const chairMember = await createMembership({
      eventId: event.id,
      userId: chair.id,
      role: "EVENT_CHAIR",
      parentId: null,
    });
    const inviterUser = await createUser();
    const inviterMember = await createMembership({
      eventId: event.id,
      userId: inviterUser.id,
      role: "DIVISION_LEADER",
      parentId: chairMember.id,
    });
    const acceptor = await createUser({ email: email("acc3") });
    const inv = await makeInvitation({
      eventId: event.id,
      invitedById: inviterMember.id,
      email: acceptor.email,
      role: "MEMBER",
      parentId: chairMember.id,
    });
    // Turunkan inviter jadi MEMBER
    await prisma.eventMember.update({
      where: { id: inviterMember.id },
      data: { role: "MEMBER" },
    });

    let err: unknown = null;
    try {
      await acceptInvitation(inv.token, userOf(acceptor));
    } catch (e) {
      err = e;
    }
    if (!(err instanceof ConflictError)) {
      console.error(
        "DS-A5 endpoint=acceptInvitation (inviter jadi MEMBER) harapan=CONFLICT aktual=" +
          (err instanceof Error ? err.constructor.name : typeof err),
      );
    }
    expect(err).toBeInstanceOf(ConflictError);
  });

  it("undangan DIVISION_LEADER tapi pembuat bukan EVENT_CHAIR ➜ CONFLICT", async () => {
    const chair = await createUser();
    const event = await createEvent({ createdById: chair.id });
    const chairMember = await createMembership({
      eventId: event.id,
      userId: chair.id,
      role: "EVENT_CHAIR",
      parentId: null,
    });
    const dlUser = await createUser();
    const dlMember = await createMembership({
      eventId: event.id,
      userId: dlUser.id,
      role: "DIVISION_LEADER",
      parentId: chairMember.id,
    });
    const acceptor = await createUser({ email: email("acc4") });
    const inv = await makeInvitation({
      eventId: event.id,
      invitedById: dlMember.id,
      email: acceptor.email,
      role: "DIVISION_LEADER",
      parentId: dlMember.id,
    });

    let err: unknown = null;
    try {
      await acceptInvitation(inv.token, userOf(acceptor));
    } catch (e) {
      err = e;
    }
    if (!(err instanceof ConflictError)) {
      console.error(
        "DS-A6 endpoint=acceptInvitation (DL bukan buatan Chair) harapan=CONFLICT aktual=" +
          (err instanceof Error ? err.constructor.name : typeof err),
      );
    }
    expect(err).toBeInstanceOf(ConflictError);
  });

  it("parent_id null pada undangan ➜ CONFLICT", async () => {
    const chair = await createUser();
    const event = await createEvent({ createdById: chair.id });
    const chairMember = await createMembership({
      eventId: event.id,
      userId: chair.id,
      role: "EVENT_CHAIR",
      parentId: null,
    });
    const acceptor = await createUser({ email: email("acc5") });
    const inv = await makeInvitation({
      eventId: event.id,
      invitedById: chairMember.id,
      email: acceptor.email,
      role: "MEMBER",
      parentId: null,
    });

    let err: unknown = null;
    try {
      await acceptInvitation(inv.token, userOf(acceptor));
    } catch (e) {
      err = e;
    }
    if (!(err instanceof ConflictError)) {
      console.error(
        "DS-A7 endpoint=acceptInvitation (parent_id null) harapan=CONFLICT aktual=" +
          (err instanceof Error ? err.constructor.name : typeof err),
      );
    }
    expect(err).toBeInstanceOf(ConflictError);
  });

  it("parent undangan tidak aktif ➜ CONFLICT", async () => {
    const chair = await createUser();
    const event = await createEvent({ createdById: chair.id });
    const chairMember = await createMembership({
      eventId: event.id,
      userId: chair.id,
      role: "EVENT_CHAIR",
      parentId: null,
    });
    const inactUser = await createUser();
    const inactMember = await createMembership({
      eventId: event.id,
      userId: inactUser.id,
      role: "MEMBER",
      parentId: chairMember.id,
      status: "INACTIVE",
    });
    const acceptor = await createUser({ email: email("acc6") });
    const inv = await makeInvitation({
      eventId: event.id,
      invitedById: chairMember.id,
      email: acceptor.email,
      role: "MEMBER",
      parentId: inactMember.id,
    });

    let err: unknown = null;
    try {
      await acceptInvitation(inv.token, userOf(acceptor));
    } catch (e) {
      err = e;
    }
    if (!(err instanceof ConflictError)) {
      console.error(
        "DS-A8 endpoint=acceptInvitation (parent tidak aktif) harapan=CONFLICT aktual=" +
          (err instanceof Error ? err.constructor.name : typeof err),
      );
    }
    expect(err).toBeInstanceOf(ConflictError);
  });

  it("DIVISION_LEADER parent di luar subtree saat accept ➜ CONFLICT", async () => {
    const chair = await createUser();
    const event = await createEvent({ createdById: chair.id });
    const chairMember = await createMembership({
      eventId: event.id,
      userId: chair.id,
      role: "EVENT_CHAIR",
      parentId: null,
    });
    const dlAUser = await createUser();
    const dlAMember = await createMembership({
      eventId: event.id,
      userId: dlAUser.id,
      role: "DIVISION_LEADER",
      parentId: chairMember.id,
    });
    const dlBUser = await createUser();
    const dlBMember = await createMembership({
      eventId: event.id,
      userId: dlBUser.id,
      role: "DIVISION_LEADER",
      parentId: chairMember.id,
    });
    const memBUser = await createUser();
    const memBMember = await createMembership({
      eventId: event.id,
      userId: memBUser.id,
      role: "MEMBER",
      parentId: dlBMember.id,
    });
    const acceptor = await createUser({ email: email("acc7") });
    // DL A membuat undangan DIVISION_LEADER dengan parent = memberB (subtree DL B)
    const inv = await makeInvitation({
      eventId: event.id,
      invitedById: dlAMember.id,
      email: acceptor.email,
      role: "DIVISION_LEADER",
      parentId: memBMember.id,
    });

    let err: unknown = null;
    try {
      await acceptInvitation(inv.token, userOf(acceptor));
    } catch (e) {
      err = e;
    }
    if (!(err instanceof ConflictError)) {
      console.error(
        "DS-A9 endpoint=acceptInvitation (DL parent luar subtree) harapan=CONFLICT aktual=" +
          (err instanceof Error ? err.constructor.name : typeof err),
      );
    }
    expect(err).toBeInstanceOf(ConflictError);
  });

  it("penerima sudah anggota ACTIVE ➜ CONFLICT", async () => {
    const chair = await createUser();
    const event = await createEvent({ createdById: chair.id });
    const chairMember = await createMembership({
      eventId: event.id,
      userId: chair.id,
      role: "EVENT_CHAIR",
      parentId: null,
    });
    const alreadyMember = await createUser({ email: email("already") });
    await createMembership({
      eventId: event.id,
      userId: alreadyMember.id,
      role: "MEMBER",
      parentId: chairMember.id,
      status: "ACTIVE",
    });
    const inv = await makeInvitation({
      eventId: event.id,
      invitedById: chairMember.id,
      email: alreadyMember.email,
      role: "MEMBER",
      parentId: chairMember.id,
    });

    let err: unknown = null;
    try {
      await acceptInvitation(inv.token, userOf(alreadyMember));
    } catch (e) {
      err = e;
    }
    if (!(err instanceof ConflictError)) {
      console.error(
        "DS-A10 endpoint=acceptInvitation (sudah anggota ACTIVE) harapan=CONFLICT aktual=" +
          (err instanceof Error ? err.constructor.name : typeof err),
      );
    }
    expect(err).toBeInstanceOf(ConflictError);
  });

  it("undangan expired race di dalam transaksi ➜ GONE (kondisi expiresAt lewat tapi masih PENDING)", async () => {
    const chair = await createUser();
    const event = await createEvent({ createdById: chair.id });
    const chairMember = await createMembership({
      eventId: event.id,
      userId: chair.id,
      role: "EVENT_CHAIR",
      parentId: null,
    });
    const acceptor = await createUser({ email: email("acc8") });
    // Buat undangan PENDING tapi expiresAt sudah lewat (simulasi race: expireStale
    // belum menangkap, namun expiresAt < now pada saat cek di dalam tx).
    const inv = await makeInvitation({
      eventId: event.id,
      invitedById: chairMember.id,
      email: acceptor.email,
      role: "MEMBER",
      parentId: chairMember.id,
      expiresAt: new Date(Date.now() - 60 * 60 * 1000),
    });

    let err: unknown = null;
    try {
      await acceptInvitation(inv.token, userOf(acceptor));
    } catch (e) {
      err = e;
    }
    if (!(err instanceof GoneError)) {
      console.error(
        "DS-A11 endpoint=acceptInvitation (expired race tx) harapan=GONE aktual=" +
          (err instanceof Error ? err.constructor.name : typeof err),
      );
    }
    expect(err).toBeInstanceOf(GoneError);
    expect((err as GoneError).code).toBe("GONE");
  });

  it("penerima sudah anggota INACTIVE ➜ reaktivasi ke ACTIVE (covers lines 693-702)", async () => {
    const chair = await createUser();
    const event = await createEvent({ createdById: chair.id });
    const chairMember = await createMembership({
      eventId: event.id,
      userId: chair.id,
      role: "EVENT_CHAIR",
      parentId: null,
    });
    const inactiveMemberUser = await createUser({ email: email("inactive") });
    const inactiveMember = await createMembership({
      eventId: event.id,
      userId: inactiveMemberUser.id,
      role: "MEMBER",
      parentId: chairMember.id,
      status: "INACTIVE",
    });
    const inv = await makeInvitation({
      eventId: event.id,
      invitedById: chairMember.id,
      email: inactiveMemberUser.email,
      role: "MEMBER",
      parentId: chairMember.id,
    });

    const result = await acceptInvitation(inv.token, userOf(inactiveMemberUser));
    expect(result.membership.status).toBe("ACTIVE");
    expect(result.membership.userId).toBe(inactiveMemberUser.id);

    const row = await prisma.eventMember.findUnique({ where: { id: inactiveMember.id } });
    expect(row.status).toBe("ACTIVE");
  });
});

// ============================================================================
// revokeInvitation (direct service) — uncovered branches
// ============================================================================
describe("revokeInvitation (direct service)", () => {
  it("updateMany count !== 1 (race: accept menang lebih dulu) ➜ CONFLICT", async () => {
    const chair = await createUser();
    const event = await createEvent({ createdById: chair.id });
    const chairMember = await createMembership({
      eventId: event.id,
      userId: chair.id,
      role: "EVENT_CHAIR",
      parentId: null,
    });
    const acceptor = await createUser({ email: email("revacc") });
    const inv = await makeInvitation({
      eventId: event.id,
      invitedById: chairMember.id,
      email: acceptor.email,
      role: "MEMBER",
      parentId: chairMember.id,
    });

    // Terima undangan terlebih dahulu sehingga status menjadi ACCEPTED.
    await acceptInvitation(inv.token, userOf(acceptor));

    // Revoke setelah accept: baris tidak lagi PENDING → updateMany count = 0 → CONFLICT.
    let err: unknown = null;
    try {
      await revokeInvitation(event.id, membershipOf(chairMember), inv.id);
    } catch (e) {
      err = e;
    }
    if (!(err instanceof ConflictError)) {
      console.error(
        "DS-R1 endpoint=revokeInvitation (sudah final) harapan=CONFLICT aktual=" +
          (err instanceof Error ? err.constructor.name : typeof err),
      );
    }
    expect(err).toBeInstanceOf(ConflictError);
    expect((err as ConflictError).code).toBe("CONFLICT");
  });
});

// ============================================================================
// expireStale (direct service) — uncovered branches
// ============================================================================
describe("expireStale (direct service)", () => {
  it("undangan PENDING lewat expiresAt ➜ di-expire, changed=true", async () => {
    const chair = await createUser();
    const event = await createEvent({ createdById: chair.id });
    const chairMember = await createMembership({
      eventId: event.id,
      userId: chair.id,
      role: "EVENT_CHAIR",
      parentId: null,
    });
    const inv = await makeInvitation({
      eventId: event.id,
      invitedById: chairMember.id,
      email: email("exp1"),
      role: "MEMBER",
      parentId: chairMember.id,
      expiresAt: new Date(Date.now() - 60 * 60 * 1000), // sudah lewat
    });

    const results = await expireStale(event.id);
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe(inv.id);
    expect(results[0].status).toBe("EXPIRED");
    expect(results[0].changed).toBe(true);

    const row = await prisma.invitation.findUnique({ where: { id: inv.id } });
    expect(row.status).toBe("EXPIRED");
  });

  it("undangan sudah EXPIRED ➜ tidak ada perubahan, changed=false / tidak masuk hasil", async () => {
    const chair = await createUser();
    const event = await createEvent({ createdById: chair.id });
    const chairMember = await createMembership({
      eventId: event.id,
      userId: chair.id,
      role: "EVENT_CHAIR",
      parentId: null,
    });
    await makeInvitation({
      eventId: event.id,
      invitedById: chairMember.id,
      email: email("exp2"),
      role: "MEMBER",
      parentId: chairMember.id,
      status: "EXPIRED",
      expiresAt: new Date(Date.now() - 60 * 60 * 1000),
    });

    const results = await expireStale(event.id);
    // Sudah final → tidak di-ambil oleh expireStale (status PENDING saja).
    expect(results).toHaveLength(0);
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});
