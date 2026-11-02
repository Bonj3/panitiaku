import { hash } from "@node-rs/argon2";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../src/config/database.js";
import { hashToken, generateOpaqueToken } from "../src/shared/utils/token.js";
import { Prisma } from "../src/generated/prisma/client.js";

// ---------------------------------------------------------------------------
// Service-level unit tests for defense-in-depth branches unreachable via
// HTTP API (middleware already rejects them at the route layer). These call
// the service functions directly with real Prisma (no mocking).
//
// Covered branches:
//   - invitation.revokeInvitation: actor INACTIVE → ForbiddenError
//   - invitation.revokeInvitation: actor MEMBER → ForbiddenError
//   - organization.moveMember: actor INACTIVE → ForbiddenError
//   - organization.moveMember: actor MEMBER → ForbiddenError
//   - finance.reverseTransaction: already-reversed → ConflictError (pre-check)
// ---------------------------------------------------------------------------

import { revokeInvitation } from "../src/modules/invitations/invitation.service.js";
import { acceptInvitation } from "../src/modules/invitations/invitation.service.js";
import { moveMember } from "../src/modules/organization/organization.service.js";
import { reverseTransaction } from "../src/modules/finance/finance.service.js";

const testUserIds: string[] = [];
const testEventIds: string[] = [];

function email(label: string): string {
  return `sg.${label}.${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
}

async function createUserAndSession() {
  const e = email("user");
  const passwordHash = await hash("password123");
  const user = await prisma.user.create({ data: { name: "SG User", email: e, passwordHash } });
  testUserIds.push(user.id);

  const tokenPlain = `tok_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await prisma.session.create({
    data: { userId: user.id, tokenHash: hashToken(tokenPlain), expiresAt, ip: null, userAgent: null },
  });

  return { id: user.id, email: e, tokenPlain };
}

async function createEventAndChair(userId: string) {
  const event = await prisma.event.create({
    data: { name: "SG Event", slug: `sg-${Date.now()}`, createdById: userId },
  });
  testEventIds.push(event.id);

  const membership = await prisma.eventMember.create({
    data: { eventId: event.id, userId, role: "EVENT_CHAIR", parentId: null, title: "Ketua", status: "ACTIVE" },
  });
  return { eventId: event.id, chairMemberId: membership.id };
}

async function createMember({
  eventId,
  userId,
  role = "MEMBER",
  parentId,
  status = "ACTIVE",
}) {
  return prisma.eventMember.create({ data: { eventId, userId, role, parentId, title: role, status } });
}

async function createPaidTransaction(eventId: string, submitterId: string, amount: string) {
  const tx = await prisma.financialTransaction.create({
    data: {
      eventId,
      type: "INCOME",
      category: "SPONSORSHIP",
      description: "test tx",
      amount,
      status: "PAID",
      submitterId,
      version: 1,
      submittedAt: new Date(),
      approvedAt: new Date(),
      paidAt: new Date(),
    },
  });
  const normalEntry = await prisma.ledgerEntry.create({
    data: {
      eventId,
      transactionId: tx.id,
      direction: "CREDIT",
      amount: new Prisma.Decimal(amount),
      postedById: submitterId,
    },
  });
  return { tx, normalEntry };
}

beforeAll(async () => {
  await prisma.$connect();
});

afterEach(async () => {
  if (testUserIds.length) {
    await prisma.session.deleteMany({ where: { userId: { in: testUserIds } } });
  }
});

afterAll(async () => {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL app.allow_ledger_delete = 'on'`);
    await tx.$executeRawUnsafe(
      `DELETE FROM ledger_entries WHERE reversal_of IS NOT NULL AND event_id IN (SELECT id FROM events WHERE slug LIKE 'sg-%')`,
    );
    await tx.$executeRawUnsafe(
      `DELETE FROM ledger_entries WHERE event_id IN (SELECT id FROM events WHERE slug LIKE 'sg-%')`,
    );
    await tx.$executeRawUnsafe(
      `DELETE FROM audit_logs WHERE event_id IN (SELECT id FROM events WHERE slug LIKE 'sg-%')`,
    );
    await tx.$executeRawUnsafe(
      `DELETE FROM transaction_history WHERE transaction_id IN (SELECT id FROM financial_transactions WHERE event_id IN (SELECT id FROM events WHERE slug LIKE 'sg-%'))`,
    );
    await tx.$executeRawUnsafe(
      `DELETE FROM financial_transactions WHERE event_id IN (SELECT id FROM events WHERE slug LIKE 'sg-%')`,
    );
    await tx.$executeRawUnsafe(
      `DELETE FROM invitations WHERE event_id IN (SELECT id FROM events WHERE slug LIKE 'sg-%')`,
    );
    await tx.$executeRawUnsafe(
      `DELETE FROM event_members WHERE event_id IN (SELECT id FROM events WHERE slug LIKE 'sg-%')`,
    );
    await tx.$executeRawUnsafe(`DELETE FROM events WHERE slug LIKE 'sg-%'`);
    await tx.$executeRawUnsafe(`DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'sg.%')`);
    await tx.$executeRawUnsafe(`DELETE FROM users WHERE email LIKE 'sg.%'`);
  });
  await prisma.$disconnect();
});

// ============================================================================
// invitation.revokeInvitation — defense-in-depth branches
// ============================================================================
describe("Service: invitation.revokeInvitation defense-in-depth", () => {
  it("actor INACTIVE → ForbiddenError", async () => {
    const chair = await createUserAndSession();
    const { eventId, chairMemberId } = await createEventAndChair(chair.id);

    const leader = await createUserAndSession();
    const leaderMember = await createMember({
      eventId, userId: leader.id, role: "DIVISION_LEADER", parentId: chairMemberId, status: "ACTIVE",
    });

    const invitee = await createUserAndSession();
    const inv = await prisma.invitation.create({
      data: {
        eventId,
        email: invitee.email,
        role: "MEMBER",
        parentId: leaderMember.id,
        invitedById: leaderMember.id,
        status: "PENDING",
        tokenHash: `hash_${Date.now()}_${Math.random().toString(36).slice(2)}`,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    await prisma.eventMember.update({
      where: { id: leaderMember.id },
      data: { status: "INACTIVE" },
    });

    let err: any = null;
    try {
      await revokeInvitation(eventId,
        { id: leaderMember.id, eventId, userId: leader.id, role: "DIVISION_LEADER", status: "INACTIVE", event: { id: eventId, name: "x", slug: "x", status: "OPEN" } },
        inv.id);
    } catch (e) { err = e; }
    expect(err).not.toBeNull();
    expect(err.name).toBe("ForbiddenError");
    expect(err.code).toBe("FORBIDDEN");
  });

  it("actor MEMBER → ForbiddenError", async () => {
    const chair = await createUserAndSession();
    const { eventId, chairMemberId } = await createEventAndChair(chair.id);

    const member = await createUserAndSession();
    const memberMember = await createMember({
      eventId, userId: member.id, role: "MEMBER", parentId: chairMemberId, status: "ACTIVE",
    });

    const invitee = await createUserAndSession();
    const inv = await prisma.invitation.create({
      data: {
        eventId,
        email: invitee.email,
        role: "MEMBER",
        parentId: chairMemberId,
        invitedById: chairMemberId,
        status: "PENDING",
        tokenHash: `hash_${Date.now()}_${Math.random().toString(36).slice(2)}`,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    let err: any = null;
    try {
      await revokeInvitation(eventId,
        { id: memberMember.id, eventId, userId: member.id, role: "MEMBER", status: "ACTIVE", event: { id: eventId, name: "x", slug: "x", status: "OPEN" } },
        inv.id);
    } catch (e) { err = e; }
    expect(err).not.toBeNull();
    expect(err.name).toBe("ForbiddenError");
    expect(err.code).toBe("FORBIDDEN");
  });
});

// ============================================================================
// invitation.acceptInvitation — defense-in-depth branches
// ============================================================================
describe("Service: invitation.acceptInvitation defense-in-depth", () => {
  it("undangan sudah REVOKED → GoneError", async () => {
    const chair = await createUserAndSession();
    const { eventId, chairMemberId } = await createEventAndChair(chair.id);

    const invitee = await createUserAndSession();
    const tokenPlain = generateOpaqueToken();
    const tokenHash = hashToken(tokenPlain);
    await prisma.invitation.create({
      data: {
        eventId,
        email: invitee.email,
        role: "MEMBER",
        parentId: chairMemberId,
        invitedById: chairMemberId,
        status: "REVOKED",
        tokenHash,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        revokedAt: new Date(),
      },
    });

    let err: any = null;
    try {
      await acceptInvitation(tokenPlain, { id: invitee.id, email: invitee.email, name: "Invitee" });
    } catch (e) { err = e; }
    expect(err).not.toBeNull();
    expect(err.name).toBe("GoneError");
    expect(err.code).toBe("GONE");
  });

  it("email penerima tidak cocok → ForbiddenError", async () => {
    const chair = await createUserAndSession();
    const { eventId, chairMemberId } = await createEventAndChair(chair.id);

    const invitee = await createUserAndSession();
    const wrongUser = await createUserAndSession();
    const tokenPlain = generateOpaqueToken();
    const tokenHash = hashToken(tokenPlain);
    await prisma.invitation.create({
      data: {
        eventId,
        email: invitee.email,
        role: "MEMBER",
        parentId: chairMemberId,
        invitedById: chairMemberId,
        status: "PENDING",
        tokenHash,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    let err: any = null;
    try {
      await acceptInvitation(tokenPlain, { id: wrongUser.id, email: wrongUser.email, name: "Wrong User" });
    } catch (e) { err = e; }
    expect(err).not.toBeNull();
    expect(err.name).toBe("ForbiddenError");
    expect(err.code).toBe("FORBIDDEN");
  });
});

// ============================================================================
// organization.moveMember — defense-in-depth branches
// ============================================================================
describe("Service: organization.moveMember defense-in-depth", () => {
  it("actor INACTIVE → ForbiddenError", async () => {
    const chair = await createUserAndSession();
    const { eventId, chairMemberId } = await createEventAndChair(chair.id);

    const leader = await createUserAndSession();
    const leaderMember = await createMember({
      eventId, userId: leader.id, role: "DIVISION_LEADER", parentId: chairMemberId, status: "ACTIVE",
    });

    const target = await createUserAndSession();
    const targetMember = await createMember({
      eventId, userId: target.id, role: "MEMBER", parentId: chairMemberId, status: "ACTIVE",
    });

    await prisma.eventMember.update({
      where: { id: leaderMember.id },
      data: { status: "INACTIVE" },
    });

    let err: any = null;
    try {
      await moveMember(eventId,
        { id: leaderMember.id, eventId, userId: leader.id, role: "DIVISION_LEADER", status: "INACTIVE", event: { id: eventId, name: "x", slug: "x", status: "OPEN" } },
        targetMember.id, chairMemberId);
    } catch (e) { err = e; }
    expect(err).not.toBeNull();
    expect(err.name).toBe("ForbiddenError");
    expect(err.code).toBe("FORBIDDEN");
  });

  it("actor MEMBER → ForbiddenError", async () => {
    const chair = await createUserAndSession();
    const { eventId, chairMemberId } = await createEventAndChair(chair.id);

    const member = await createUserAndSession();
    const memberMember = await createMember({
      eventId, userId: member.id, role: "MEMBER", parentId: chairMemberId, status: "ACTIVE",
    });

    const target = await createUserAndSession();
    const targetMember = await createMember({
      eventId, userId: target.id, role: "MEMBER", parentId: chairMemberId, status: "ACTIVE",
    });

    let err: any = null;
    try {
      await moveMember(eventId,
        { id: memberMember.id, eventId, userId: member.id, role: "MEMBER", status: "ACTIVE", event: { id: eventId, name: "x", slug: "x", status: "OPEN" } },
        targetMember.id, chairMemberId);
    } catch (e) { err = e; }
    expect(err).not.toBeNull();
    expect(err.name).toBe("ForbiddenError");
    expect(err.code).toBe("FORBIDDEN");
  });
});

// ============================================================================
// finance.reverseTransaction — already reversed pre-check
// ============================================================================
describe("Service: finance.reverseTransaction already-reversed", () => {
  it("reverse transaksi yang sudah direversi → ConflictError", async () => {
    const chair = await createUserAndSession();
    const { eventId, chairMemberId } = await createEventAndChair(chair.id);

    const { tx, normalEntry } = await createPaidTransaction(eventId, chairMemberId, "1000000.00");

    // Buat reversal entry secara manual
    await prisma.ledgerEntry.create({
      data: {
        eventId,
        transactionId: tx.id,
        direction: "DEBIT",
        amount: new Prisma.Decimal("1000000.00"),
        postedById: chairMemberId,
        reversalOfId: normalEntry.id,
      },
    });

    // Reverse lagi → pre-check existingReversal menangkap → ConflictError
    let err: any = null;
    try {
      await reverseTransaction(eventId, tx.id, { reason: "duplikasi" }, chairMemberId);
    } catch (e) { err = e; }
    expect(err).not.toBeNull();
    expect(err.name).toBe("ConflictError");
    expect(err.code).toBe("CONFLICT");
  });
});
