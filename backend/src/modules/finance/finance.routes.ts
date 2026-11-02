import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import { eventMembership } from '../../middleware/event-membership.js';
import { requireEventRole } from '../../middleware/require-event-role.js';
import { financeController } from './finance.controller.js';

/**
 * Rute keuangan event (PROJECT §13.6).
 *
 * Path dipasang di app.ts dengan prefix /api/v1/events/:eventId, sehingga
 * req.params.eventId tersedia untuk eventMembership. Router pakai mergeParams.
 *
 * Urutan middleware: authenticate → eventMembership → [requireEventRole] → controller.
 * Semua otorisasi di backend.
 */
export const financeRoutes = Router({ mergeParams: true });

// Ringkasan saldo (semua anggota aktif)
financeRoutes.get('/finance/summary', authenticate, eventMembership, financeController.getSummary);

// Daftar transaksi + filter + pagination (semua anggota aktif)
financeRoutes.get('/transactions', authenticate, eventMembership, financeController.list);

// Buat transaksi DRAFT (semua anggota aktif)
financeRoutes.post('/transactions', authenticate, eventMembership, financeController.create);

// Detail transaksi + history + ledger (semua anggota aktif)
financeRoutes.get(
  '/transactions/:txId',
  authenticate,
  eventMembership,
  financeController.getDetail
);

// Edit DRAFT — pemilik atau Chair
financeRoutes.patch('/transactions/:txId', authenticate, eventMembership, financeController.update);

// Submit DRAFT → SUBMITTED — pemilik atau Chair
financeRoutes.post(
  '/transactions/:txId/submit',
  authenticate,
  eventMembership,
  financeController.submit
);

// Approve SUBMITTED → APPROVED — HANYA Chair
financeRoutes.post(
  '/transactions/:txId/approve',
  authenticate,
  eventMembership,
  requireEventRole('EVENT_CHAIR'),
  financeController.approve
);

// Reject SUBMITTED → REJECTED — HANYA Chair
financeRoutes.post(
  '/transactions/:txId/reject',
  authenticate,
  eventMembership,
  requireEventRole('EVENT_CHAIR'),
  financeController.reject
);

// Pay APPROVED → PAID + ledger posting — HANYA Chair
financeRoutes.post(
  '/transactions/:txId/pay',
  authenticate,
  eventMembership,
  requireEventRole('EVENT_CHAIR'),
  financeController.pay
);

// Cancel — sesuai matriks §5.C
financeRoutes.post(
  '/transactions/:txId/cancel',
  authenticate,
  eventMembership,
  financeController.cancel
);

// Reverse PAID via reversal entry — HANYA Chair
financeRoutes.post(
  '/transactions/:txId/reverse',
  authenticate,
  eventMembership,
  requireEventRole('EVENT_CHAIR'),
  financeController.reverse
);

// Reopen REJECTED → DRAFT — pemilik atau Chair
financeRoutes.post(
  '/transactions/:txId/reopen',
  authenticate,
  eventMembership,
  financeController.reopen
);
