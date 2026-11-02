import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Prisma } from '../src/generated/prisma/client.js';
import { prisma } from '../src/config/database.js';
import {
  app,
  ensureCsrf,
  sharedCsrf,
  makeAgent,
  makeEventAndMembership,
  cleanupTestData,
} from './finance.helpers.js';
import supertest from 'supertest';

const ORIGIN = 'http://localhost:5173';

function cookieHeader(tokenPlain: string, csrfToken: string): string {
  return `ec_csrf=${csrfToken}; ec_session=${tokenPlain}`;
}

async function getAuditLogs(
  tokenPlain: string,
  csrfToken: string,
  eventId: string,
  query?: Record<string, string>
) {
  const url = new URL(`/api/v1/events/${eventId}/audit-logs`, 'http://localhost');
  if (query) for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  return supertest(app)
    .get(url.pathname + url.search)
    .set('Origin', ORIGIN)
    .set('Cookie', cookieHeader(tokenPlain, csrfToken));
}

const PII_EMAIL = 'john.doe@example.com';
const PII_PHONE = '08123456789';
const PII_ACCOUNT = '1234567890123456';

describe('GET /api/v1/events/:eventId/audit-logs — sanitasi-on-read metadata', () => {
  beforeAll(async () => {
    await prisma.$connect();
    await ensureCsrf();
  });

  afterAll(async () => {
    await cleanupTestData();
    await prisma.$disconnect();
  });

  it('metadata legacy dengan PII dan kunci non-whitelist disaring pada saat dibaca, tidak ada PII yang bocor', async () => {
    const chair = await makeAgent('EVENT_CHAIR');
    const { eventId, membershipId } = await makeEventAndMembership(chair.id);

    const maliciousMetadata = {
      // Kunci whitelist, nilai valid.
      fromRole: 'EVENT_CHAIR',
      fromStatus: 'ACTIVE',
      toStatus: 'INACTIVE',
      sizeBytes: 1024,
      mimeType: 'image/png',
      trigger: 'manual',
      role: 'MEMBER',
      fields: ['type', 'amount', 'banned-field'],
      // Kunci whitelist, nilai TIDAK valid → harus dibuang seluruhnya.
      toRole: 'SUPER_ADMIN',
      sizeBytesNegatif: -5,
      mimeTypeBad: 'text/html',
      evidenceId: 'bukan-uuid',
      // Kunci di luar whitelist (termasuk yang nilainya PII) → kunci dibuang.
      arbitraryKey: `${PII_EMAIL} ${PII_ACCOUNT} ${PII_PHONE}`,
      email: 'jane.doe@example.com',
      note: `alasan bebas: hubungi ${PII_PHONE}`,
      fileKey: 'deadbeef',
      tokenHash: 'should-not-appear',
    };

    await prisma.auditLog.create({
      data: {
        eventId,
        actorId: membershipId,
        action: 'member.role.update',
        entityType: 'member',
        entityId: 'member-legacy-1',
        metadata: maliciousMetadata as unknown as Prisma.InputJsonValue,
      },
    });

    // Baris lain: metadata bersih harus lolos utuh.
    await prisma.auditLog.create({
      data: {
        eventId,
        actorId: membershipId,
        action: 'member.status.update',
        entityType: 'member',
        entityId: 'member-legacy-2',
        metadata: {
          fromStatus: 'ACTIVE',
          toStatus: 'INACTIVE',
          fields: ['status'],
        } as unknown as Prisma.InputJsonValue,
      },
    });

    // Baris lain: metadata NULL harus tetap NULL (tidak dibuang barisnya).
    await prisma.auditLog.create({
      data: {
        eventId,
        actorId: membershipId,
        action: 'event.create',
        entityType: 'event',
        entityId: eventId,
        metadata: null,
      },
    });

    const res = await getAuditLogs(chair.tokenPlain, sharedCsrf, eventId);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const items = res.body.data.items;
    expect(items.length).toBe(3);

    const byEntityId =
      Object.groupBy?.(items, (i: any) => i.entityId) ??
      items.reduce<Record<string, any[]>>((acc, i: any) => {
        (acc[i.entityId] ??= []).push(i);
        return acc;
      }, {});

    // Baris berisiko: metadata kembali sudah disaring — kunci aman & nilai aman.
    const legacyItems = byEntityId['member-legacy-1'];
    expect(legacyItems).toHaveLength(1);
    expect(legacyItems[0].metadata).toEqual({
      fromRole: 'EVENT_CHAIR',
      fromStatus: 'ACTIVE',
      toStatus: 'INACTIVE',
      sizeBytes: 1024,
      mimeType: 'image/png',
      trigger: 'manual',
      role: 'MEMBER',
      fields: ['type', 'amount'],
    });

    const metaStr = JSON.stringify(res.body);
    expect(metaStr).not.toContain(PII_EMAIL);
    expect(metaStr).not.toContain(PII_PHONE);
    expect(metaStr).not.toContain(PII_ACCOUNT);
    expect(metaStr).not.toContain('jane.doe@example.com');
    expect(metaStr).not.toContain('SUPER_ADMIN');
    expect(metaStr).not.toContain('text/html');
    expect(metaStr).not.toContain('bukan-uuid');
    expect(metaStr).not.toContain('arbitraryKey');
    expect(metaStr).not.toContain('banned-field');
    expect(metaStr).not.toContain('fileKey');
    expect(metaStr).not.toContain('tokenHash');
    expect(metaStr).not.toContain('alasan bebas');
    expect(metaStr).not.toContain('note');
    expect(metaStr).not.toContain('evidenceId');
    expect(metaStr).not.toContain('sizeBytesNegatif');
    expect(metaStr).not.toContain('mimeTypeBad');

    // Baris bersih lolos utuh.
    const cleanItems = byEntityId['member-legacy-2'];
    expect(cleanItems).toHaveLength(1);
    expect(cleanItems[0].metadata).toEqual({
      fromStatus: 'ACTIVE',
      toStatus: 'INACTIVE',
      fields: ['status'],
    });

    // Baris NULL tetap NULL; baris itu sendiri tidak dihapus (retensi audit).
    const nullItems = byEntityId[eventId];
    expect(nullItems).toHaveLength(1);
    expect(nullItems[0].metadata).toBeNull();
  });

  it('eventId bukan UUID → 404', async () => {
    const chair = await makeAgent('EVENT_CHAIR');
    const { eventId } = await makeEventAndMembership(chair.id);
    const res = await getAuditLogs(chair.tokenPlain, sharedCsrf, 'bukan-uuid');
    expect(res.status).toBe(404);
    // Pastikan event yang valid masih bisa diakses (tidak ada efek samping).
    const ok = await getAuditLogs(chair.tokenPlain, sharedCsrf, eventId);
    expect(ok.status).toBe(200);
  });

  it('non-EVENT_CHAIR tidak dapat membaca audit log → 403', async () => {
    const chair = await makeAgent('EVENT_CHAIR');
    const { eventId, membershipId } = await makeEventAndMembership(chair.id);

    const memberUser = await makeAgent('MEMBER');
    await prisma.eventMember.create({
      data: {
        eventId,
        userId: memberUser.id,
        role: 'MEMBER',
        parentId: membershipId,
        title: 'Member',
        status: 'ACTIVE',
      },
    });

    const res = await getAuditLogs(memberUser.tokenPlain, sharedCsrf, eventId);
    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });
});
