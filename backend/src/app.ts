import express, { Application, Request, Response } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import { env } from './config/env.js';
import { requestIdMiddleware } from './shared/utils/request-id.js';
import { csrf } from './middleware/csrf.js';
import { errorHandler } from './middleware/error-handler.js';
import { authRoutes } from './modules/auth/auth.routes.js';
import { eventRoutes } from './modules/events/event.routes.js';
import { organizationRoutes } from './modules/organization/organization.routes.js';
import { invitationRoutes } from './modules/invitations/invitation.routes.js';
import { invitationPublicRoutes } from './modules/invitations/invitation.public.routes.js';
import { financeRoutes } from './modules/finance/finance.routes.js';
import { evidenceRoutes } from './modules/finance/evidence.routes.js';
import { auditRoutes } from './modules/audit/audit.routes.js';
import { Envelope } from './shared/types/http.js';

export function createApp(): Application {
  const app = express();

  // Trust proxy: jangan pernah percaya X-Forwarded-For secara default.
  // Rate limit berbasis IP dapat dilewati bila seluruh rantai header dipercaya.
  // Aktifkan hanya sebanyak hop proxy yang benar-benar kita kendalikan
  // (TRUST_PROXY_HOPS), dan pastikan backend tidak dapat dijangkau langsung.
  app.set('trust proxy', env.TRUST_PROXY_HOPS > 0 ? env.TRUST_PROXY_HOPS : false);

  // Security headers
  app.use(helmet());

  // CORS allowlist dari env; credentials true; tolak "*"
  const allowedOrigins = env.CORS_ORIGIN.split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  app.use(
    cors({
      origin: allowedOrigins.length > 0 ? allowedOrigins : false,
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id', 'X-CSRF-Token'],
    })
  );

  // Body parser (limit 1MB)
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));

  // Cookie parser (sesi httpOnly)
  app.use(cookieParser());

  // CSRF double-submit cookie (butuh req.cookies dari cookieParser)
  app.use(csrf);

  // Rate limiting in-memory (1 instance MVP)
  app.use(
    rateLimit({
      windowMs: 60 * 1000,
      max: 100,
      standardHeaders: true,
      legacyHeaders: false,
      message: {
        success: false,
        error: { code: 'RATE_LIMITED', message: 'Terlalu banyak permintaan, coba lagi nanti.' },
      },
    })
  );

  // Request ID
  app.use(requestIdMiddleware);

  // Rute autentikasi
  app.use('/api/v1/auth', authRoutes);

  // Rute event & keanggotaan (Sebelum not found handler)
  app.use('/api/v1/events', eventRoutes);

  // Rute organisasi & anggota event (mount dengan :eventId di parent)
  app.use('/api/v1/events/:eventId', organizationRoutes);

  // Rute undangan berbasis event (mount dengan :eventId di parent)
  app.use('/api/v1/events/:eventId/invitations', invitationRoutes);

  // Rute keuangan berbasis event (mount dengan :eventId di parent)
  app.use('/api/v1/events/:eventId', financeRoutes);

  // Rute bukti transaksi (mount dengan :eventId dan :txId di parent)
  app.use(
    '/api/v1/events/:eventId/transactions/:txId/evidence',
    evidenceRoutes
  );

  // Rute audit log berbasis event (mount dengan :eventId di parent)
  app.use('/api/v1/events/:eventId', auditRoutes);

  // Rute undangan publik (tanpa autentikasi session)
  app.use('/api/v1/invitations', invitationPublicRoutes);

  // Health check
  app.get('/api/v1/health', (_req: Request, res: Response) => {
    const envelope: Envelope = {
      success: true,
      data: { status: 'ok' },
    };
    res.json(envelope);
  });

  // Not found handler (untuk route yang tidak cocok)
  app.use((_req: Request, res: Response) => {
    res.status(404).json({
      success: false,
      error: {
        code: 'NOT_FOUND',
        message: 'Endpoint tidak ditemukan',
        details: {},
      },
    });
  });

  // Error handler harus terakhir
  app.use(errorHandler);

  return app;
}
