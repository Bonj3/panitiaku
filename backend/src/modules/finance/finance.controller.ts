import { Request, Response } from 'express';
import { z } from 'zod';
import { NotFoundError, UnauthorizedError } from '../../shared/errors/app-error.js';
import {
  createTransactionSchema,
  type CreateTransactionInput,
  updateTransactionSchema,
  type UpdateTransactionInput,
  submitTransactionSchema,
  approveTransactionSchema,
  rejectTransactionSchema,
  type RejectTransactionInput,
  payTransactionSchema,
  type PayTransactionInput,
  cancelTransactionSchema,
  type CancelTransactionInput,
  reverseTransactionSchema,
  type ReverseTransactionInput,
  reopenTransactionSchema,
  listTransactionsQuerySchema,
  type ListTransactionsQuery,
} from './finance.validator.js';
import {
  createTransaction,
  updateTransaction,
  submitTransaction,
  approveTransaction,
  rejectTransaction,
  reopenTransaction,
  payTransaction,
  cancelTransaction,
  reverseTransaction,
  getSummary,
  listTransactions,
  getTransactionDetail,
} from './finance.service.js';

function parseUuidParam(req: Request, name: string): string {
  const v = req.params[name];
  if (typeof v !== 'string' || !z.string().uuid().safeParse(v).success) {
    throw new NotFoundError('Resource tidak ditemukan');
  }
  return v;
}

function requireMembershipId(req: Request): string {
  const m = req.membership;
  if (!m) {
    throw new UnauthorizedError('Keanggotaan event tidak tersedia');
  }
  return m.id;
}

export const financeController = {
  async getSummary(req: Request, res: Response): Promise<void> {
    const eventId = parseUuidParam(req, 'eventId');
    const data = await getSummary(eventId);
    res.status(200).json({ success: true, data });
  },

  async list(req: Request, res: Response): Promise<void> {
    const eventId = parseUuidParam(req, 'eventId');
    const input = listTransactionsQuerySchema.parse(req.query) as ListTransactionsQuery;
    const data = await listTransactions(eventId, input);
    res.status(200).json({ success: true, data: { items: data.items, meta: data.meta } });
  },

  async create(req: Request, res: Response): Promise<void> {
    const eventId = parseUuidParam(req, 'eventId');
    const input = createTransactionSchema.parse(req.body) as CreateTransactionInput;
    const actorId = requireMembershipId(req);
    const data = await createTransaction(
      eventId,
      { ...input, currency: input.currency ?? 'IDR' },
      actorId
    );
    res.status(201).json({ success: true, data });
  },

  async getDetail(req: Request, res: Response): Promise<void> {
    const eventId = parseUuidParam(req, 'eventId');
    const txId = parseUuidParam(req, 'txId');
    const data = await getTransactionDetail(eventId, txId);
    res.status(200).json({ success: true, data });
  },

  async update(req: Request, res: Response): Promise<void> {
    const eventId = parseUuidParam(req, 'eventId');
    const txId = parseUuidParam(req, 'txId');
    const input = updateTransactionSchema.parse(req.body) as UpdateTransactionInput;
    const actorId = requireMembershipId(req);
    const data = await updateTransaction(eventId, txId, input, actorId);
    res.status(200).json({ success: true, data });
  },

  async submit(req: Request, res: Response): Promise<void> {
    const eventId = parseUuidParam(req, 'eventId');
    const txId = parseUuidParam(req, 'txId');
    submitTransactionSchema.parse(req.body ?? {});
    const actorId = requireMembershipId(req);
    const data = await submitTransaction(eventId, txId, actorId);
    res.status(200).json({ success: true, data });
  },

  async approve(req: Request, res: Response): Promise<void> {
    const eventId = parseUuidParam(req, 'eventId');
    const txId = parseUuidParam(req, 'txId');
    approveTransactionSchema.parse(req.body ?? {});
    const actorId = requireMembershipId(req);
    const data = await approveTransaction(eventId, txId, actorId);
    res.status(200).json({ success: true, data });
  },

  async reject(req: Request, res: Response): Promise<void> {
    const eventId = parseUuidParam(req, 'eventId');
    const txId = parseUuidParam(req, 'txId');
    const input = rejectTransactionSchema.parse(req.body) as RejectTransactionInput;
    const actorId = requireMembershipId(req);
    const data = await rejectTransaction(eventId, txId, input, actorId);
    res.status(200).json({ success: true, data });
  },

  async reopen(req: Request, res: Response): Promise<void> {
    const eventId = parseUuidParam(req, 'eventId');
    const txId = parseUuidParam(req, 'txId');
    reopenTransactionSchema.parse(req.body ?? {});
    const actorId = requireMembershipId(req);
    const data = await reopenTransaction(eventId, txId, actorId);
    res.status(200).json({ success: true, data });
  },

  async pay(req: Request, res: Response): Promise<void> {
    const eventId = parseUuidParam(req, 'eventId');
    const txId = parseUuidParam(req, 'txId');
    const input = payTransactionSchema.parse(req.body ?? {}) as PayTransactionInput;
    const actorId = requireMembershipId(req);
    const data = await payTransaction(eventId, txId, input, actorId);
    res.status(200).json({ success: true, data });
  },

  async cancel(req: Request, res: Response): Promise<void> {
    const eventId = parseUuidParam(req, 'eventId');
    const txId = parseUuidParam(req, 'txId');
    const input = cancelTransactionSchema.parse(req.body ?? {}) as CancelTransactionInput;
    const actorId = requireMembershipId(req);
    const data = await cancelTransaction(eventId, txId, input, actorId);
    res.status(200).json({ success: true, data });
  },

  async reverse(req: Request, res: Response): Promise<void> {
    const eventId = parseUuidParam(req, 'eventId');
    const txId = parseUuidParam(req, 'txId');
    const input = reverseTransactionSchema.parse(req.body) as ReverseTransactionInput;
    const actorId = requireMembershipId(req);
    const data = await reverseTransaction(eventId, txId, input, actorId);
    res.status(201).json({ success: true, data });
  },
};
