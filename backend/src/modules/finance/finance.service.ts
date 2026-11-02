import { Prisma } from '../../generated/prisma/client.js';
import { prisma } from '../../config/database.js';
import { writeAudit } from '../audit/audit.service.js';
import { redactNote } from '../../shared/utils/pii-redaction.js';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnprocessableError,
} from '../../shared/errors/app-error.js';
import {
  CATEGORY_WHITELIST,
  formatMoney,
  type TxDetail,
  type TxHistory,
  type TxItem,
  type TxLedgerEntry,
  type TxStatus,
} from './finance.types.js';

type TxWithRelations = Prisma.FinancialTransactionGetPayload<{
  include: {
    submitter: { include: { user: true } };
    approver: { include: { user: true } };
  };
}>;

type LedgerWithPostedBy = Prisma.LedgerEntryGetPayload<{
  include: { postedBy: { include: { user: true } } };
}>;

type HistoryWithChangedBy = Prisma.TransactionHistoryGetPayload<{
  include: { changedBy: { include: { user: true } } };
}>;

const ZERO = new Prisma.Decimal(0);

/** Transisi status yang diizinkan (dari → [ke yang diizinkan]). Diekspor untuk unit test matriks transisi. */
export const ALLOWED_TRANSITIONS: Record<TxStatus, TxStatus[]> = {
  DRAFT: ['SUBMITTED', 'CANCELLED'],
  SUBMITTED: ['APPROVED', 'REJECTED', 'CANCELLED'],
  APPROVED: ['PAID', 'CANCELLED'],
  REJECTED: ['DRAFT', 'CANCELLED'],
  PAID: [],
  CANCELLED: [],
};

export function assertTransition(from: TxStatus, to: TxStatus): void {
  const allowed = ALLOWED_TRANSITIONS[from];
  if (!allowed || !allowed.includes(to)) {
    throw new UnprocessableError(`Transisi status ${from} → ${to} tidak diizinkan`, {
      details: { from, to },
    });
  }
}

/** Re-baca aktor dari DB; throws jika tidak ditemukan atau tidak aktif. */
async function requireActiveActor(
  tx: Prisma.TransactionClient,
  eventId: string,
  actorMembershipId: string
): Promise<{ id: string; role: string; status: string }> {
  const actor = await tx.eventMember.findFirst({
    where: { id: actorMembershipId, eventId },
    select: { id: true, role: true, status: true },
  });
  if (!actor || actor.status !== 'ACTIVE') {
    throw new ForbiddenError('Keanggotaan Anda tidak aktif pada event ini');
  }
  return actor;
}

function requireOwnerOrChair(
  actor: { id: string; role: string; status: string },
  tx: TxWithRelations
): void {
  const isOwner = tx.submitterId === actor.id;
  const isChair = actor.role === 'EVENT_CHAIR';
  if (!isOwner && !isChair) {
    throw new ForbiddenError('Hanya pemilik transaksi atau Ketua Event yang boleh');
  }
}

function requireChair(actor: { id: string; role: string; status: string }): void {
  if (actor.role !== 'EVENT_CHAIR') {
    throw new ForbiddenError('Hanya Ketua Event yang boleh melakukan tindakan ini');
  }
}

function requireEventOpen(event: { status: string } | null): void {
  if (!event || event.status !== 'OPEN') {
    throw new ConflictError('Event sudah ditutup');
  }
}

/** Get /finance/summary — saldo dari ledger_entries, bukan transactions.amount. */
export async function getSummary(eventId: string): Promise<{
  balance: string;
  totalIncome: string;
  totalExpense: string;
  pendingCount: number;
}> {
  // Ledger adalah sumber kebenaran saldo (BR-09, BR-10).
  // Jangan menjumlah financial_transactions.amount untuk saldo.
  // Satu query groupBy untuk total income dan expense sekaligus.
  const groups = await prisma.ledgerEntry.groupBy({
    by: ['direction'],
    where: { eventId },
    _sum: { amount: true },
  });

  let income = ZERO;
  let expense = ZERO;
  for (const g of groups) {
    const sum = g._sum.amount ?? ZERO;
    if (g.direction === 'CREDIT') income = income.plus(sum);
    else expense = expense.plus(sum);
  }

  const totalIncome = formatMoney(income);
  const totalExpense = formatMoney(expense);
  const balance = formatMoney(income.minus(expense));

  const pending = await prisma.financialTransaction.count({
    where: { eventId, status: 'SUBMITTED' },
  });

  return { balance, totalIncome, totalExpense, pendingCount: pending };
}

/** GET /transactions — list + filter + pagination. */
export async function listTransactions(
  eventId: string,
  query: {
    status?: TxStatus;
    type?: 'INCOME' | 'EXPENSE';
    category?: string;
    q?: string;
    page: number;
    perPage: number;
  }
): Promise<{
  items: TxItem[];
  meta: { page: number; perPage: number; total: number; totalPages: number };
}> {
  const where: Prisma.FinancialTransactionWhereInput = { eventId };
  if (query.status) where.status = query.status;
  if (query.type) where.type = query.type;
  if (query.category) where.category = query.category;
  if (query.q) {
    where.description = { contains: query.q, mode: 'insensitive' };
  }

  const page = Math.max(1, query.page);
  const perPage = Math.min(100, Math.max(1, query.perPage));
  const skip = (page - 1) * perPage;

  const [items, total] = await Promise.all([
    prisma.financialTransaction.findMany({
      where,
      include: {
        submitter: { include: { user: true } },
        approver: { include: { user: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: perPage,
    }),
    prisma.financialTransaction.count({ where }),
  ]);

  return {
    items: items.map(toTxItem),
    meta: { page, perPage, total, totalPages: Math.ceil(total / perPage) },
  };
}

function toTxItem(tx: TxWithRelations): TxItem {
  return {
    id: tx.id,
    type: tx.type as 'INCOME' | 'EXPENSE',
    category: tx.category,
    description: tx.description,
    amount: formatMoney(tx.amount),
    currency: tx.currency,
    status: tx.status as TxStatus,
    version: tx.version,
    submitter: tx.submitter ? { id: tx.submitter.id, name: tx.submitter.user.name } : null,
    approver: tx.approver ? { id: tx.approver.id, name: tx.approver.user.name } : null,
    submittedAt: tx.submittedAt,
    approvedAt: tx.approvedAt,
    paidAt: tx.paidAt,
    createdAt: tx.createdAt,
    updatedAt: tx.updatedAt,
  };
}

/** GET /transactions/:txId — detail + history + ledger. */
export async function getTransactionDetail(eventId: string, txId: string): Promise<TxDetail> {
  const tx = await prisma.financialTransaction.findFirst({
    where: { id: txId, eventId },
    include: {
      submitter: { include: { user: true } },
      approver: { include: { user: true } },
    },
  });
  if (!tx) {
    throw new NotFoundError('Transaksi tidak ditemukan pada event ini');
  }

  const history = await prisma.transactionHistory.findMany({
    where: { transactionId: txId },
    orderBy: { createdAt: 'asc' },
    include: { changedBy: { include: { user: true } } },
  });

  const ledger = await prisma.ledgerEntry.findMany({
    where: { transactionId: txId },
    orderBy: { postedAt: 'asc' },
    include: { postedBy: { include: { user: true } } },
  });

  return {
    ...toTxItem(tx),
    eventId: tx.eventId,
    rejectReason: tx.rejectReason,
    history: history.map(toTxHistory),
    ledger: ledger.map((l) => ({
      id: l.id,
      direction: l.direction as 'CREDIT' | 'DEBIT',
      amount: formatMoney(l.amount),
      postedAt: l.postedAt,
      postedBy: { id: l.postedBy.id, name: l.postedBy.user.name },
      reversalOfId: l.reversalOfId,
      narration: l.narration,
    })),
  };
}

function toTxHistory(h: HistoryWithChangedBy): TxHistory {
  return {
    id: h.id,
    fromStatus: h.fromStatus as TxStatus | null,
    toStatus: h.toStatus as TxStatus,
    changedBy: { id: h.changedBy.id, name: h.changedBy.user.name },
    note: h.note,
    createdAt: h.createdAt,
  };
}

/** POST /transactions — buat DRAFT. */
export async function createTransaction(
  eventId: string,
  input: {
    type: 'INCOME' | 'EXPENSE';
    category: string;
    description: string;
    amount: string;
    currency?: string;
  },
  actorMembershipId: string
): Promise<TxItem> {
  const allowedCategories = CATEGORY_WHITELIST[input.type];
  if (!allowedCategories || !allowedCategories.includes(input.category)) {
    throw new UnprocessableError('Kategori tidak cocok dengan tipe transaksi', {
      details: {
        type: input.type,
        category: input.category,
        allowed: allowedCategories,
      },
    });
  }

  return prisma.$transaction(async (tx) => {
    // Lock event untuk serialisasi pembuatan transaksi.
    await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM events WHERE id = ${eventId}::uuid FOR UPDATE;
    `;

    const event = await tx.event.findFirst({
      where: { id: eventId },
      select: { id: true, status: true },
    });
    requireEventOpen(event);

    // Re-baca aktor dari DB: role/status bisa berubah setelah middleware.
    await requireActiveActor(tx, eventId, actorMembershipId);

    const created = await tx.financialTransaction.create({
      data: {
        eventId,
        type: input.type,
        category: input.category,
        description: input.description,
        amount: input.amount,
        currency: input.currency ?? 'IDR',
        status: 'DRAFT',
        submitterId: actorMembershipId,
        version: 1,
      },
      include: {
        submitter: { include: { user: true } },
        approver: { include: { user: true } },
      },
    });

    await tx.transactionHistory.create({
      data: {
        transactionId: created.id,
        fromStatus: null,
        toStatus: 'DRAFT',
        changedById: actorMembershipId,
        note: 'CREATED',
      },
    });

    await writeAudit(tx, {
      eventId,
      actorId: actorMembershipId,
      action: 'transaction.create',
      entityType: 'transaction',
      entityId: created.id,
      metadata: {
        type: input.type,
        category: input.category,
        amount: input.amount,
        currency: input.currency ?? 'IDR',
      },
    });

    return toTxItem(created);
  });
}

/** PATCH /transactions/:txId — hanya DRAFT, pemilik atau Chair. */
export async function updateTransaction(
  eventId: string,
  txId: string,
  input: {
    type?: 'INCOME' | 'EXPENSE';
    category?: string;
    description?: string;
    amount?: string;
  },
  actorMembershipId: string
): Promise<TxItem> {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM events WHERE id = ${eventId}::uuid FOR UPDATE;
    `;

    const actor = await requireActiveActor(tx, eventId, actorMembershipId);

    const current = await tx.financialTransaction.findFirst({
      where: { id: txId, eventId },
      include: {
        submitter: { include: { user: true } },
        approver: { include: { user: true } },
      },
    });
    if (!current) {
      throw new NotFoundError('Transaksi tidak ditemukan pada event ini');
    }
    if (current.status !== 'DRAFT') {
      throw new ConflictError('Hanya transaksi DRAFT yang dapat diedit');
    }
    requireOwnerOrChair(actor, current);

    const newType = input.type ?? current.type;
    const newCategory = input.category ?? current.category;
    const allowed = CATEGORY_WHITELIST[newType];
    if (!allowed || !allowed.includes(newCategory)) {
      throw new UnprocessableError('Kategori tidak cocok dengan tipe transaksi', {
        details: { type: newType, category: newCategory, allowed },
      });
    }

    const changed: string[] = [];
    if (input.type !== undefined && input.type !== current.type) changed.push('type');
    if (input.category !== undefined && input.category !== current.category)
      changed.push('category');
    if (input.description !== undefined && input.description !== current.description)
      changed.push('description');
    if (input.amount !== undefined && input.amount !== current.amount.toString())
      changed.push('amount');

    const updated = await tx.financialTransaction.update({
      where: { id: txId },
      data: {
        ...(input.type !== undefined ? { type: input.type } : {}),
        ...(input.category !== undefined ? { category: input.category } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.amount !== undefined ? { amount: input.amount } : {}),
        version: { increment: 1 },
      },
      include: {
        submitter: { include: { user: true } },
        approver: { include: { user: true } },
      },
    });

    await tx.transactionHistory.create({
      data: {
        transactionId: txId,
        fromStatus: 'DRAFT',
        toStatus: 'DRAFT',
        changedById: actorMembershipId,
        note: changed.length ? `UPDATED (${changed.join(', ')})` : 'UPDATED',
      },
    });

    await writeAudit(tx, {
      eventId,
      actorId: actorMembershipId,
      action: 'transaction.update',
      entityType: 'transaction',
      entityId: txId,
      metadata: { fields: changed },
    });

    return toTxItem(updated);
  });
}

/** POST /transactions/:txId/submit — DRAFT → SUBMITTED. */
export async function submitTransaction(
  eventId: string,
  txId: string,
  actorMembershipId: string
): Promise<TxItem> {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM events WHERE id = ${eventId}::uuid FOR UPDATE;
    `;

    const event = await tx.event.findFirst({
      where: { id: eventId },
      select: { id: true, status: true },
    });
    requireEventOpen(event);

    const actor = await requireActiveActor(tx, eventId, actorMembershipId);

    const current = await tx.financialTransaction.findFirst({
      where: { id: txId, eventId },
      include: {
        submitter: { include: { user: true } },
        approver: { include: { user: true } },
      },
    });
    if (!current) {
      throw new NotFoundError('Transaksi tidak ditemukan pada event ini');
    }
    assertTransition(current.status, 'SUBMITTED');
    requireOwnerOrChair(actor, current);

    const updated = await tx.financialTransaction.update({
      where: { id: txId },
      data: {
        status: 'SUBMITTED',
        submittedAt: new Date(),
        version: { increment: 1 },
      },
      include: {
        submitter: { include: { user: true } },
        approver: { include: { user: true } },
      },
    });

    await tx.transactionHistory.create({
      data: {
        transactionId: txId,
        fromStatus: 'DRAFT',
        toStatus: 'SUBMITTED',
        changedById: actorMembershipId,
        note: 'SUBMITTED',
      },
    });

    await writeAudit(tx, {
      eventId,
      actorId: actorMembershipId,
      action: 'transaction.submit',
      entityType: 'transaction',
      entityId: txId,
      metadata: { fromStatus: 'DRAFT', toStatus: 'SUBMITTED' },
    });

    return toTxItem(updated);
  });
}

/** POST /transactions/:txId/approve — SUBMITTED → APPROVED, HANYA Chair. */
export async function approveTransaction(
  eventId: string,
  txId: string,
  actorMembershipId: string
): Promise<TxItem> {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM events WHERE id = ${eventId}::uuid FOR UPDATE;
    `;

    const event = await tx.event.findFirst({
      where: { id: eventId },
      select: { id: true, status: true },
    });
    requireEventOpen(event);

    const actor = await requireActiveActor(tx, eventId, actorMembershipId);
    requireChair(actor);

    const current = await tx.financialTransaction.findFirst({
      where: { id: txId, eventId },
      include: {
        submitter: { include: { user: true } },
        approver: { include: { user: true } },
      },
    });
    if (!current) {
      throw new NotFoundError('Transaksi tidak ditemukan pada event ini');
    }
    assertTransition(current.status, 'APPROVED');

    const updated = await tx.financialTransaction.update({
      where: { id: txId },
      data: {
        status: 'APPROVED',
        approverId: actorMembershipId,
        approvedAt: new Date(),
        version: { increment: 1 },
      },
      include: {
        submitter: { include: { user: true } },
        approver: { include: { user: true } },
      },
    });

    await tx.transactionHistory.create({
      data: {
        transactionId: txId,
        fromStatus: 'SUBMITTED',
        toStatus: 'APPROVED',
        changedById: actorMembershipId,
        note: 'APPROVED',
      },
    });

    await writeAudit(tx, {
      eventId,
      actorId: actorMembershipId,
      action: 'transaction.approve',
      entityType: 'transaction',
      entityId: txId,
      metadata: { fromStatus: 'SUBMITTED', toStatus: 'APPROVED' },
    });

    return toTxItem(updated);
  });
}

/** POST /transactions/:txId/reject — SUBMITTED → REJECTED, HANYA Chair. */
export async function rejectTransaction(
  eventId: string,
  txId: string,
  input: { reason: string },
  actorMembershipId: string
): Promise<TxItem> {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM events WHERE id = ${eventId}::uuid FOR UPDATE;
    `;

    const event = await tx.event.findFirst({
      where: { id: eventId },
      select: { id: true, status: true },
    });
    requireEventOpen(event);

    const actor = await requireActiveActor(tx, eventId, actorMembershipId);
    requireChair(actor);

    const current = await tx.financialTransaction.findFirst({
      where: { id: txId, eventId },
      include: {
        submitter: { include: { user: true } },
        approver: { include: { user: true } },
      },
    });
    if (!current) {
      throw new NotFoundError('Transaksi tidak ditemukan pada event ini');
    }
    assertTransition(current.status, 'REJECTED');

    const updated = await tx.financialTransaction.update({
      where: { id: txId },
      data: {
        status: 'REJECTED',
        approverId: actorMembershipId,
        rejectReason: redactNote(input.reason),
        version: { increment: 1 },
      },
      include: {
        submitter: { include: { user: true } },
        approver: { include: { user: true } },
      },
    });

    await tx.transactionHistory.create({
      data: {
        transactionId: txId,
        fromStatus: 'SUBMITTED',
        toStatus: 'REJECTED',
        changedById: actorMembershipId,
        note: `REJECTED: ${redactNote(input.reason)}`,
      },
    });

    await writeAudit(tx, {
      eventId,
      actorId: actorMembershipId,
      action: 'transaction.reject',
      entityType: 'transaction',
      entityId: txId,
      metadata: { fromStatus: 'SUBMITTED', toStatus: 'REJECTED' },
    });

    return toTxItem(updated);
  });
}

/** POST /transactions/:txId/reopen — REJECTED → DRAFT. */
export async function reopenTransaction(
  eventId: string,
  txId: string,
  actorMembershipId: string
): Promise<TxItem> {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM events WHERE id = ${eventId}::uuid FOR UPDATE;
    `;

    const event = await tx.event.findFirst({
      where: { id: eventId },
      select: { id: true, status: true },
    });
    requireEventOpen(event);

    const actor = await requireActiveActor(tx, eventId, actorMembershipId);

    const current = await tx.financialTransaction.findFirst({
      where: { id: txId, eventId },
      include: {
        submitter: { include: { user: true } },
        approver: { include: { user: true } },
      },
    });
    if (!current) {
      throw new NotFoundError('Transaksi tidak ditemukan pada event ini');
    }
    assertTransition(current.status, 'DRAFT');
    requireOwnerOrChair(actor, current);

    const updated = await tx.financialTransaction.update({
      where: { id: txId },
      data: {
        status: 'DRAFT',
        rejectReason: null,
        approverId: null,
        approvedAt: null,
        submittedAt: null,
        version: { increment: 1 },
      },
      include: {
        submitter: { include: { user: true } },
        approver: { include: { user: true } },
      },
    });

    await tx.transactionHistory.create({
      data: {
        transactionId: txId,
        fromStatus: 'REJECTED',
        toStatus: 'DRAFT',
        changedById: actorMembershipId,
        note: 'REOPENED',
      },
    });

    await writeAudit(tx, {
      eventId,
      actorId: actorMembershipId,
      action: 'transaction.reopen',
      entityType: 'transaction',
      entityId: txId,
      metadata: { fromStatus: 'REJECTED', toStatus: 'DRAFT' },
    });

    return toTxItem(updated);
  });
}

/** POST /transactions/:txId/pay — APPROVED → PAID + ledger posting atomik. */
export async function payTransaction(
  eventId: string,
  txId: string,
  input: { narration?: string | null },
  actorMembershipId: string
): Promise<{ transaction: TxItem; ledgerEntry: TxLedgerEntry }> {
  return prisma.$transaction(async (tx) => {
    // URUTAN LOCK: event dulu, baru transaksi/ledger (mencegah deadlock).
    await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM events WHERE id = ${eventId}::uuid FOR UPDATE;
    `;

    const event = await tx.event.findFirst({
      where: { id: eventId },
      select: { id: true, status: true },
    });
    requireEventOpen(event);

    const actor = await requireActiveActor(tx, eventId, actorMembershipId);
    requireChair(actor);

    const current = await tx.financialTransaction.findFirst({
      where: { id: txId, eventId },
      include: {
        submitter: { include: { user: true } },
        approver: { include: { user: true } },
      },
    });
    if (!current) {
      throw new NotFoundError('Transaksi tidak ditemukan pada event ini');
    }
    // PAID → 409 (double payment, BR-11); status lain yang bukan APPROVED → 422.
    if (current.status === 'PAID') {
      throw new ConflictError('Transaksi sudah dibayar');
    }
    assertTransition(current.status, 'PAID');

    // Cek apakah sudah ada ledger normal (idempotency guard BR-11).
    const existing = await tx.ledgerEntry.findFirst({
      where: { transactionId: txId, reversalOfId: null },
    });
    if (existing) {
      throw new ConflictError('Transaksi sudah diposting');
    }

    const direction: 'CREDIT' | 'DEBIT' = current.type === 'INCOME' ? 'CREDIT' : 'DEBIT';

    let ledgerEntry: LedgerWithPostedBy;
    try {
      ledgerEntry = (await tx.ledgerEntry.create({
        data: {
          eventId,
          transactionId: txId,
          direction,
          amount: current.amount,
          postedById: actorMembershipId,
          narration: redactNote(input.narration ?? null),
        },
        include: { postedBy: { include: { user: true } } },
      })) as unknown as LedgerWithPostedBy;
    } catch (err) {
      const prismaErr = err as { code?: string };
      // P2002 = unique constraint violation pada partial unique index
      // UNIQUE(transaction_id) WHERE reversal_of IS NULL → double posting.
      if (prismaErr.code === 'P2002') {
        throw new ConflictError('Transaksi sudah diposting');
      }
      throw err;
    }

    const updated = await tx.financialTransaction.update({
      where: { id: txId },
      data: { status: 'PAID', paidAt: new Date(), version: { increment: 1 } },
      include: {
        submitter: { include: { user: true } },
        approver: { include: { user: true } },
      },
    });

    await tx.transactionHistory.create({
      data: {
        transactionId: txId,
        fromStatus: 'APPROVED',
        toStatus: 'PAID',
        changedById: actorMembershipId,
        note: 'PAID',
      },
    });

    await writeAudit(tx, {
      eventId,
      actorId: actorMembershipId,
      action: 'transaction.pay',
      entityType: 'transaction',
      entityId: txId,
      metadata: { fromStatus: 'APPROVED', toStatus: 'PAID' },
    });

    return {
      transaction: toTxItem(updated),
      ledgerEntry: {
        id: ledgerEntry.id,
        direction: ledgerEntry.direction as 'CREDIT' | 'DEBIT',
        amount: formatMoney(ledgerEntry.amount),
        postedAt: ledgerEntry.postedAt,
        postedBy: { id: ledgerEntry.postedBy.id, name: ledgerEntry.postedBy.user.name },
        reversalOfId: ledgerEntry.reversalOfId,
        narration: ledgerEntry.narration,
      },
    };
  });
}

/** POST /transactions/:txId/cancel — sesuai matriks transisi. */
export async function cancelTransaction(
  eventId: string,
  txId: string,
  input: { reason?: string | null },
  actorMembershipId: string
): Promise<TxItem> {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM events WHERE id = ${eventId}::uuid FOR UPDATE;
    `;

    const actor = await requireActiveActor(tx, eventId, actorMembershipId);

    const current = await tx.financialTransaction.findFirst({
      where: { id: txId, eventId },
      include: {
        submitter: { include: { user: true } },
        approver: { include: { user: true } },
      },
    });
    if (!current) {
      throw new NotFoundError('Transaksi tidak ditemukan pada event ini');
    }

    assertTransition(current.status, 'CANCELLED');

    // Otorisasi per status (matriks §5.C).
    const isOwner = current.submitterId === actor.id;
    const isChair = actor.role === 'EVENT_CHAIR';
    switch (current.status) {
      case 'DRAFT':
      case 'SUBMITTED':
      case 'REJECTED':
        if (!isOwner && !isChair) {
          throw new ForbiddenError(
            'Hanya pemilik transaksi atau Ketua Event yang boleh membatalkan'
          );
        }
        break;
      case 'APPROVED':
        if (!isChair) {
          throw new ForbiddenError('Hanya Ketua Event yang boleh membatalkan transaksi APPROVED');
        }
        break;
      default:
        throw new ConflictError('Transaksi tidak dapat dibatalkan');
    }

    const updated = await tx.financialTransaction.update({
      where: { id: txId },
      data: { status: 'CANCELLED', version: { increment: 1 } },
      include: {
        submitter: { include: { user: true } },
        approver: { include: { user: true } },
      },
    });

    await tx.transactionHistory.create({
      data: {
        transactionId: txId,
        fromStatus: current.status,
        toStatus: 'CANCELLED',
        changedById: actor.id,
        note: input.reason ? `CANCELLED: ${redactNote(input.reason)}` : 'CANCELLED',
      },
    });

    await writeAudit(tx, {
      eventId,
      actorId: actorMembershipId,
      action: 'transaction.cancel',
      entityType: 'transaction',
      entityId: txId,
      metadata: { fromStatus: current.status, toStatus: 'CANCELLED' },
    });

    return toTxItem(updated);
  });
}

/** POST /transactions/:txId/reverse — HANYA Chair, hanya PAID, insert reversal entry. */
export async function reverseTransaction(
  eventId: string,
  txId: string,
  input: { reason: string },
  actorMembershipId: string
): Promise<{ reversalEntry: TxLedgerEntry }> {
  return prisma.$transaction(async (tx) => {
    // URUTAN LOCK: event dulu, baru transaksi/ledger.
    await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM events WHERE id = ${eventId}::uuid FOR UPDATE;
    `;

    const actor = await requireActiveActor(tx, eventId, actorMembershipId);
    requireChair(actor);

    const current = await tx.financialTransaction.findFirst({
      where: { id: txId, eventId },
      include: {
        submitter: { include: { user: true } },
        approver: { include: { user: true } },
      },
    });
    if (!current) {
      throw new NotFoundError('Transaksi tidak ditemukan pada event ini');
    }
    if (current.status !== 'PAID') {
      throw new ConflictError('Hanya transaksi PAID yang dapat direversi');
    }

    // Cari ledger normal (reversalOfId IS NULL) milik transaksi ini.
    const normalEntry = await tx.ledgerEntry.findFirst({
      where: { transactionId: txId, reversalOfId: null },
    });
    if (!normalEntry) {
      throw new ConflictError('Transaksi belum memiliki ledger posting normal');
    }

    // Pre-check: sudah ada reversal untuk entry ini?
    const existingReversal = await tx.ledgerEntry.findFirst({
      where: { reversalOfId: normalEntry.id },
    });
    if (existingReversal) {
      throw new ConflictError('Transaksi sudah direversi');
    }

    const reverseDirection: 'CREDIT' | 'DEBIT' =
      normalEntry.direction === 'CREDIT' ? 'DEBIT' : 'CREDIT';

    let reversalEntry: LedgerWithPostedBy;
    try {
      reversalEntry = (await tx.ledgerEntry.create({
        data: {
          eventId,
          transactionId: txId,
          direction: reverseDirection,
          amount: normalEntry.amount,
          postedById: actorMembershipId,
          reversalOfId: normalEntry.id,
          narration: redactNote(input.reason ?? null),
        },
        include: { postedBy: { include: { user: true } } },
      })) as unknown as LedgerWithPostedBy;
    } catch (err) {
      const prismaErr = err as { code?: string };
      if (prismaErr.code === 'P2002') {
        throw new ConflictError('Transaksi sudah direversi');
      }
      throw err;
    }

    await tx.transactionHistory.create({
      data: {
        transactionId: txId,
        fromStatus: 'PAID',
        toStatus: 'PAID',
        changedById: actorMembershipId,
        note: `REVERSAL: ${redactNote(input.reason)}`,
      },
    });

    await writeAudit(tx, {
      eventId,
      actorId: actorMembershipId,
      action: 'transaction.reverse',
      entityType: 'transaction',
      entityId: txId,
      metadata: { fromStatus: 'PAID', toStatus: 'PAID' },
    });

    return {
      reversalEntry: {
        id: reversalEntry.id,
        direction: reversalEntry.direction as 'CREDIT' | 'DEBIT',
        amount: formatMoney(reversalEntry.amount),
        postedAt: reversalEntry.postedAt,
        postedBy: {
          id: reversalEntry.postedBy.id,
          name: reversalEntry.postedBy.user.name,
        },
        reversalOfId: reversalEntry.reversalOfId,
        narration: reversalEntry.narration,
      },
    };
  });
}

/** BR-15: saat event ditutup, cancel transaksi DRAFT/SUBMITTED/APPROVED. */
export async function cancelTransactionsOnClose(
  eventId: string,
  actorMembershipId: string,
  tx: Prisma.TransactionClient
): Promise<number> {
  const toCancel = await tx.financialTransaction.findMany({
    where: {
      eventId,
      status: { in: ['DRAFT', 'SUBMITTED', 'APPROVED'] as TxStatus[] },
    },
    select: { id: true, status: true },
  });

  if (toCancel.length === 0) return 0;

  await tx.financialTransaction.updateMany({
    where: {
      eventId,
      status: { in: ['DRAFT', 'SUBMITTED', 'APPROVED'] as TxStatus[] },
    },
    data: { status: 'CANCELLED', version: { increment: 1 } },
  });

  for (const t of toCancel) {
    await tx.transactionHistory.create({
      data: {
        transactionId: t.id,
        fromStatus: t.status,
        toStatus: 'CANCELLED',
        changedById: actorMembershipId,
        note: 'EVENT_CLOSED',
      },
    });

    await writeAudit(tx, {
      eventId,
      actorId: actorMembershipId,
      action: 'transaction.cancel_on_event_close',
      entityType: 'transaction',
      entityId: t.id,
      metadata: { fromStatus: t.status, toStatus: 'CANCELLED', reason: 'EVENT_CLOSED' },
    });
  }

  return toCancel.length;
}
