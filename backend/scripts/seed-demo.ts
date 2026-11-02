import { hash } from '@node-rs/argon2';
import { prisma, disconnectDb } from '../src/config/database.js';

/**
 * Nama database yang diizinkan untuk demo seed — daftar eksplisit dan ketat.
 * Hanya nama ini (tepat, bukan substring) yang boleh di-seed, dan keduanya
 * adalah database non-produksi. Nama produksi atau sembarang nama database
 * selalu ditolak.
 */
export const ALLOWED_DEMO_SEED_DATABASES = [
  'event_committee',
  'event_committee_test',
] as const;
export type AllowedDemoSeedDatabase =
  (typeof ALLOWED_DEMO_SEED_DATABASES)[number];

/**
 * Validasi nama database untuk demo seed. Tidak ada pemadanan substring:
 * hanya nama dalam allowlist yang diterima, sehingga database produksi dan
 * nama sembarang selalu ditolak.
 */
export function validateDemoSeedDatabase(
  databaseName: string
): AllowedDemoSeedDatabase {
  if (!ALLOWED_DEMO_SEED_DATABASES.includes(databaseName)) {
    throw new Error(
      `Refusing to seed database '${databaseName}': database tidak ada dalam allowlist demo seed (` +
        `${ALLOWED_DEMO_SEED_DATABASES.join(', ')}). Tambahkan nama secara eksplisit bila diperlukan.`
    );
  }
  return databaseName;
}

const demoPassword = 'DemoOnly-ChangeMe-2026!';
const usersData = [
  { name: 'Demo Chair', email: 'chair.demo@example.test', role: 'EVENT_CHAIR' as const },
  {
    name: 'Demo Leader',
    email: 'leader.demo@example.test',
    role: 'DIVISION_LEADER' as const,
  },
  { name: 'Demo Member', email: 'member.demo@example.test', role: 'MEMBER' as const },
];

async function runDemoSeed(databaseName: string): Promise<void> {
  if (process.env.DEMO_SEED !== '1') {
    throw new Error('Refusing to seed: set DEMO_SEED=1 explicitly.');
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Demo seed is disabled in production.');
  }

  const passwordHash = await hash(demoPassword);

  console.warn(
    `Demo seed pada database '${databaseName}' bersifat idempotent (upsert): ` +
      'akun demo yang sudah ada akan ditimpa, termasuk password yang di-reset ke nilai demo.'
  );
  await prisma.$transaction(async (tx) => {
    const users = await Promise.all(
      usersData.map((user) =>
        tx.user.upsert({
          where: { email: user.email },
          create: { name: user.name, email: user.email, passwordHash },
          update: { name: user.name, passwordHash },
        })
      )
    );
    const chair = users[0]!;
    const event = await tx.event.upsert({
      where: { slug: 'demo-committee' },
      create: {
        name: 'Demo Committee (non-production)',
        slug: 'demo-committee',
        createdById: chair.id,
      },
      update: {
        name: 'Demo Committee (non-production)',
        createdById: chair.id,
      },
    });
    const chairMembership = await tx.eventMember.upsert({
      where: { userId_eventId: { userId: chair.id, eventId: event.id } },
      create: {
        userId: chair.id,
        eventId: event.id,
        role: 'EVENT_CHAIR',
        title: 'Chair',
      },
      update: { role: 'EVENT_CHAIR', parentId: null, status: 'ACTIVE' },
    });
    for (const [index, user] of users.slice(1).entries()) {
      await tx.eventMember.upsert({
        where: { userId_eventId: { userId: user.id, eventId: event.id } },
        create: {
          userId: user.id,
          eventId: event.id,
          role: usersData[index + 1]!.role,
          parentId: chairMembership.id,
        },
        update: {
          role: usersData[index + 1]!.role,
          parentId: chairMembership.id,
          status: 'ACTIVE',
        },
      });
    }
  });
  console.info(
    `Demo seed siap di database '${databaseName}'. ` +
      `Akun: ${usersData.map((u) => u.email).join(', ')}. ` +
      'Event: demo-committee (Demo Committee (non-production)). ' +
      'Password demo shared (lihat README); jangan pakai untuk akun nyata.'
  );
}

// Hanya jalankan saat berkas ini adalah entri CLI (`tsx scripts/seed-demo.ts`),
// bukan saat diimpor oleh tes, agar tes dapat menguji `validateDemoSeedDatabase`
// tanpa efek samping. Nama berkas dicocokkan tanpa path agar berjalan di
// Windows (backslash) dan POSIX.
const entryName = (process.argv[1] ?? '').split(/[\\/]/).pop() ?? '';
if (entryName === 'seed-demo.ts' || entryName === 'seed-demo.js') {
  void (async () => {
    try {
      const databaseName = validateDemoSeedDatabase(
        new URL(process.env.DATABASE_URL ?? '').pathname.slice(1)
      );
      await runDemoSeed(databaseName);
    } finally {
      await disconnectDb();
    }
  })();
}
