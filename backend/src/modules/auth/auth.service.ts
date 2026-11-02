import { hash, verify, type Options as Argon2Options } from "@node-rs/argon2";
import { prisma } from "../../config/database.js";
import { generateOpaqueToken, hashToken } from "../../shared/utils/token.js";
import { ConflictError, UnauthorizedError } from "../../shared/errors/app-error.js";
import {
  AuthenticatedUser,
  EventMembership,
} from "../../shared/types/http.js";
import type { LoginInput, RegisterInput } from "./auth.validator.js";

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Parameter Argon2id eksplisit (baseline OWASP: m=19 MiB, t=2, p=1).
 * Ditetapkan eksplisit agar perubahan default library tidak diam-diam
 * menurunkan biaya hashing. `algorithm: 2` = Argon2id (const enum
 * @node-rs/argon2 tidak aman diakses saat runtime).
 */
const ARGON2_OPTIONS: Argon2Options = {
  algorithm: 2,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};

// Hash dummy untuk verifikasi saat user tidak ada, sehingga masa eksekusi
// argon2 sama antara "user tidak ditemukan" dan "kata sandi salah" (mengurangi
// user enumeration melalui timing).
let dummyPasswordHash: string | null = null;

async function getDummyPasswordHash(): Promise<string> {
  if (!dummyPasswordHash) {
    dummyPasswordHash = await hash("__auth_dummy_password__", ARGON2_OPTIONS);
  }
  return dummyPasswordHash;
}

function toPublicUser(user: {
  id: string;
  email: string;
  name: string;
}): AuthenticatedUser {
  return { id: user.id, email: user.email, name: user.name };
}

export const authService = {
  async register(input: RegisterInput): Promise<AuthenticatedUser> {
    const existing = await prisma.user.findUnique({
      where: { email: input.email },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictError("Email sudah terdaftar");
    }

    const passwordHash = await hash(input.password, ARGON2_OPTIONS);
    const user = await prisma.user.create({
      data: {
        name: input.name,
        email: input.email,
        passwordHash,
      },
      select: { id: true, name: true, email: true },
    });
    return toPublicUser(user);
  },

  async login(
    input: LoginInput,
    meta?: { ip?: string; userAgent?: string },
  ): Promise<{ user: AuthenticatedUser; token: string }> {
    const user = await prisma.user.findUnique({
      where: { email: input.email },
      select: { id: true, name: true, email: true, passwordHash: true },
    });

    // Selalu jalankan argon2 verify (bahkan saat user tidak ada) agar respons
    // tidak membedakan secara terukur antara email tidak terdaftar vs kata sandi salah.
    const passwordOk = user
      ? await verify(user.passwordHash, input.password)
      : await verify(await getDummyPasswordHash(), input.password);

    if (!user || !passwordOk) {
      throw new UnauthorizedError("Email atau kata sandi salah");
    }

    const token = generateOpaqueToken();
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
    await prisma.session.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(token),
        expiresAt,
        ip: meta?.ip ?? null,
        userAgent: meta?.userAgent ?? null,
      },
    });

    return { user: toPublicUser(user), token };
  },

  async logout(token: string): Promise<void> {
    const tokenHash = hashToken(token);
    try {
      await prisma.session.update({
        where: { tokenHash },
        data: { revokedAt: new Date() },
      });
    } catch (err) {
      const prismaErr = err as { code?: string };
      // P2025 = record tidak ditemukan; logout idempotent (sudah direvoked).
      if (prismaErr.code !== "P2025") {
        throw err;
      }
    }
  },

  async refresh(
    token: string,
    meta?: { ip?: string; userAgent?: string },
  ): Promise<{ user: AuthenticatedUser; token: string }> {
    const tokenHash = hashToken(token);
    const now = new Date();

    const session = await prisma.session.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (
      !session ||
      session.revokedAt !== null ||
      session.expiresAt <= now
    ) {
      throw new UnauthorizedError("Sesi tidak valid atau kadaluarsa");
    }

    const newToken = generateOpaqueToken();
    const newExpiresAt = new Date(Date.now() + SESSION_TTL_MS);

    // Rotasi atomik + aman terhadap konkurensi: revoke bersyarat hanya bila
    // sesi lama MASIH aktif. Bila dua request refresh memakai token yang sama
    // berjalan bersamaan, hanya satu yang berhasil (count = 1); request lain
    // ditolak. Jadi satu token tidak pernah melahirkan dua sesi valid.
    await prisma.$transaction(async (tx) => {
      const revoked = await tx.session.updateMany({
        where: {
          tokenHash,
          revokedAt: null,
          expiresAt: { gt: now },
        },
        data: { revokedAt: new Date() },
      });

      if (revoked.count !== 1) {
        throw new UnauthorizedError("Sesi tidak valid atau kadaluarsa");
      }

      await tx.session.create({
        data: {
          userId: session.userId,
          tokenHash: hashToken(newToken),
          expiresAt: newExpiresAt,
          ip: meta?.ip ?? null,
          userAgent: meta?.userAgent ?? null,
        },
      });
    });

    return { user: toPublicUser(session.user), token: newToken };
  },

  async me(userId: string): Promise<{
    user: AuthenticatedUser;
    memberships: EventMembership[];
  }> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, email: true },
    });
    if (!user) {
      throw new UnauthorizedError("Pengguna tidak ditemukan");
    }

    const memberships = await prisma.eventMember.findMany({
      where: { userId },
      include: {
        event: { select: { id: true, name: true, slug: true, status: true } },
      },
      orderBy: { joinedAt: "asc" },
    });

    return {
      user: toPublicUser(user),
      memberships: memberships.map((membership) => ({
        id: membership.id,
        eventId: membership.eventId,
        userId: membership.userId,
        role: membership.role,
        status: membership.status,
        event: {
          id: membership.event.id,
          name: membership.event.name,
          slug: membership.event.slug,
          status: membership.event.status,
        },
      })),
    };
  },
};
