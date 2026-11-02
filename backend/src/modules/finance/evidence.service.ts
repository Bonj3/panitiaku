import { prisma } from '../../config/database.js';
import { writeAudit } from '../audit/audit.service.js';
import { ForbiddenError, NotFoundError } from '../../shared/errors/app-error.js';
import { generateFileKey, sanitizeOriginalName } from '../../shared/utils/file-validation.js';
import { storageProvider } from '../storage/s3-storage-provider.js';
import type { EvidenceMetadata } from './evidence.types.js';
import type { Prisma } from '../../generated/prisma/client.js';

/** Payload hasil unggah sebelum commit DB. */
interface StagedUpload {
  fileKey: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  buffer: Buffer;
}

/**
 * Unggah bukti transaksi secara aman.
 *
 * Alur:
 *  1. Authorisasi + validasi berkas (sebelum menyentuh storage).
 *  2. Unggah objek ke storage privat.
 *  3. DB tx: lock event → lock transaksi → re-check status/aktor → insert
 *     evidence + audit_log secara atomik.
 *  4. Jika DB gagal setelah objek terunggah: hapus objek sebagai kompensasi
 *     (tidak biarkan objek terpecah tanpa referensi DB).
 */
export async function uploadEvidence(
  eventId: string,
  txId: string,
  actorMembershipId: string,
  staged: StagedUpload,
  isPaymentProof: boolean
): Promise<EvidenceMetadata> {
  // 1. Validasi berkas sudah dilakukan sebelum pemanggilan ini (ukuran, MIME,
  //    magic bytes, ekstensi). Di sini hanya memastikan buffer masih ada.

  // 2. Simpan referensi objek sebelum DB tx (untuk kompensasi jika gagal).
  const fileKey = generateFileKey();

  try {
    return await prisma.$transaction(async (tx) => {
      // URUTAN LOCK: event dulu, baru transaksi (konsisten dengan finance).
      await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM events WHERE id = ${eventId}::uuid FOR UPDATE;
      `;

      const event = await tx.event.findFirst({
        where: { id: eventId },
        select: { id: true, status: true },
      });
      if (!event) {
        throw new NotFoundError('Event tidak ditemukan');
      }

      const actor = await tx.eventMember.findFirst({
        where: { id: actorMembershipId, eventId },
        select: { id: true, role: true, status: true },
      });
      if (!actor || actor.status !== 'ACTIVE') {
        throw new ForbiddenError('Keanggotaan Anda tidak aktif pada event ini');
      }

      const current = await tx.financialTransaction.findFirst({
        where: { id: txId, eventId },
        include: { submitter: { include: { user: true } } },
      });
      if (!current) {
        throw new NotFoundError('Transaksi tidak ditemukan pada event ini');
      }

      // Otorisasi unggah (least privilege).
      const isOwner = current.submitterId === actor.id;
      const isChair = actor.role === 'EVENT_CHAIR';

      if (event.status === 'CLOSED') {
        // Hanya Chair, hanya bukti pembayaran/koreksi reversi.
        if (!isChair || !isPaymentProof) {
          throw new ForbiddenError(
            'Event sudah ditutup; hanya Ketua Event dapat mengunggah bukti pembayaran'
          );
        }
      } else {
        if (current.status === 'DRAFT') {
          // Pemilik dapat melampirkan bukti pendukung pada DRAFT.
          if (!isOwner) {
            throw new ForbiddenError('Hanya pemilik transaksi DRAFT yang dapat melampirkan bukti');
          }
        } else if (current.status === 'APPROVED' || current.status === 'PAID') {
          // Hanya Chair, hanya bukti pembayaran.
          if (!isChair || !isPaymentProof) {
            throw new ForbiddenError(
              'Hanya Ketua Event yang dapat melampirkan bukti pembayaran pada transaksi ini'
            );
          }
        } else {
          // SUBMITTED, REJECTED, CANCELLED: hanya Chair bukti pendukung.
          if (!isChair) {
            throw new ForbiddenError(
              'Hanya Ketua Event yang dapat melampirkan bukti pada transaksi ini'
            );
          }
        }
      }

      // 3. Unggah ke storage privat.
      await storageProvider.put({
        key: fileKey,
        body: staged.buffer,
        contentType: staged.mimeType,
      });

      // 4. Insert evidence + audit dalam transaksi yang sama.
      const evidence = await tx.transactionEvidence.create({
        data: {
          transactionId: txId,
          fileKey,
          originalName: sanitizeOriginalName(staged.originalName),
          mimeType: staged.mimeType,
          sizeBytes: staged.sizeBytes,
          isPaymentProof,
          uploadedById: actorMembershipId,
        },
        include: {
          uploadedBy: { include: { user: true } },
        },
      });

      await writeAudit(tx, {
        eventId,
        actorId: actorMembershipId,
        action: 'evidence.upload',
        entityType: 'evidence',
        entityId: evidence.id,
        metadata: {
          isPaymentProof,
          sizeBytes: staged.sizeBytes,
          mimeType: staged.mimeType,
          sensitive: false,
        },
      });

      return toEvidenceMetadata(evidence);
    });
  } catch (err) {
    // Kompensasi: jika objek sudah terunggah ke storage tetapi DB gagal,
    // hapus objek untuk tidak menyimpan berkas orphan.
    if (storageProvider.isAvailable()) {
      try {
        await storageProvider.delete({ key: fileKey });
      } catch {
        // Gagal hapus objek orphan — log, tidak boleh menyembunyikan error asli.
        console.error('[evidence] Gagal membersihkan objek orphan');
      }
    }
    throw err;
  }
}

/**
 * Terbitkan signed URL untuk akses bukti. Semua anggota aktif event boleh.
 * Audit `evidence.access` secara atomik sebelum menandatangani.
 */
export async function getEvidenceSignedUrl(
  eventId: string,
  txId: string,
  evidenceId: string,
  actorMembershipId: string,
  ttlSeconds: number
): Promise<{ url: string; expiresAt: Date; evidence: EvidenceMetadata }> {
  return prisma.$transaction(async (tx) => {
    // Lock event dulu untuk konsistensi.
    await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM events WHERE id = ${eventId}::uuid FOR UPDATE;
    `;

    const actor = await tx.eventMember.findFirst({
      where: { id: actorMembershipId, eventId },
      select: { id: true, role: true, status: true },
    });
    if (!actor || actor.status !== 'ACTIVE') {
      throw new ForbiddenError('Keanggotaan Anda tidak aktif pada event ini');
    }

    // Bukti harus dimiliki oleh transaksi yang diminta (txId) DALAM event
    // yang diminta (eventId). Bukti milik transaksi lain dalam event sama
    // → 404 (hindari IDOR lintas-transaksi).
    const evidence = await tx.transactionEvidence.findFirst({
      where: { id: evidenceId, transactionId: txId },
      include: {
        transaction: {
          select: { id: true, eventId: true },
        },
        uploadedBy: { include: { user: true } },
      },
    });
    if (!evidence) {
      throw new NotFoundError('Bukti tidak ditemukan');
    }
    if (evidence.transaction.eventId !== eventId) {
      // Lintas-event → 404 (tidak bocorkan keberadaan).
      throw new NotFoundError('Bukti tidak ditemukan pada event ini');
    }

    // Audit akses (BR-12/BR-13, PROJECT R6). Tidak log URL/file key/nama file.
    await writeAudit(tx, {
      eventId,
      actorId: actorMembershipId,
      action: 'evidence.access',
      entityType: 'evidence',
      entityId: evidenceId,
      metadata: { transactionId: evidence.transactionId },
    });

    const signed = await storageProvider.signedGetUrl({
      key: evidence.fileKey,
      ttlSeconds,
    });

    return {
      url: signed.url,
      expiresAt: signed.expiresAt,
      evidence: toEvidenceMetadata(evidence),
    };
  });
}

/**
 * Ubah flag sensitive (Hanya Chair). Audit di dalam transaksi yang sama.
 */
export async function updateEvidenceSensitive(
  eventId: string,
  txId: string,
  evidenceId: string,
  actorMembershipId: string,
  sensitive: boolean
): Promise<EvidenceMetadata> {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM events WHERE id = ${eventId}::uuid FOR UPDATE;
    `;

    const actor = await tx.eventMember.findFirst({
      where: { id: actorMembershipId, eventId },
      select: { id: true, role: true, status: true },
    });
    if (!actor || actor.status !== 'ACTIVE') {
      throw new ForbiddenError('Keanggotaan Anda tidak aktif pada event ini');
    }
    if (actor.role !== 'EVENT_CHAIR') {
      throw new ForbiddenError('Hanya Ketua Event yang dapat mengubah flag sensitive');
    }

    const evidence = await tx.transactionEvidence.findFirst({
      where: { id: evidenceId, transactionId: txId },
      include: {
        transaction: { select: { id: true, eventId: true } },
        uploadedBy: { include: { user: true } },
      },
    });
    if (!evidence) {
      throw new NotFoundError('Bukti tidak ditemukan');
    }
    if (evidence.transaction.eventId !== eventId) {
      throw new NotFoundError('Bukti tidak ditemukan pada event ini');
    }

    const updated = await tx.transactionEvidence.update({
      where: { id: evidenceId },
      data: { sensitive },
      include: {
        transaction: { select: { id: true, eventId: true } },
        uploadedBy: { include: { user: true } },
      },
    });

    await writeAudit(tx, {
      eventId,
      actorId: actorMembershipId,
      action: 'evidence.sensitive.update',
      entityType: 'evidence',
      entityId: evidenceId,
      metadata: { sensitive },
    });

    return toEvidenceMetadata(updated);
  });
}

/** Dapatkan daftar evidence metadata untuk transaksi (digunakan controller detail). */
export async function listEvidenceForTransaction(
  eventId: string,
  txId: string
): Promise<EvidenceMetadata[]> {
  return prisma.$transaction(async (tx) => {
    // URUTAN LOCK: event dulu (konsisten dengan layanan lain di finance).
    await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM events WHERE id = ${eventId}::uuid FOR UPDATE;
    `;

    // Transaksi harus ada dalam event yang diminta SEBELUM daftar evidence
    // ditampilkan, sehingga transaksi tidak ada / lintas-event selalu 404
    // bahkan ketika belum ada evidence (tidak kembali []).
    const current = await tx.financialTransaction.findFirst({
      where: { id: txId, eventId },
      select: { id: true },
    });
    if (!current) {
      throw new NotFoundError('Transaksi tidak ditemukan pada event ini');
    }

    const rows = await tx.transactionEvidence.findMany({
      where: { transactionId: txId },
      include: {
        transaction: { select: { id: true, eventId: true } },
        uploadedBy: { include: { user: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return rows.map(toEvidenceMetadata);
  });
}

function toEvidenceMetadata(
  ev: Prisma.TransactionEvidenceGetPayload<{
    include: { uploadedBy: { include: { user: true } } };
  }>
): EvidenceMetadata {
  return {
    id: ev.id,
    transactionId: ev.transactionId,
    originalName: sanitizeOriginalName(ev.originalName),
    mimeType: ev.mimeType as Extract<
      string,
      'image/jpeg' | 'image/png' | 'application/pdf' | 'image/webp'
    >,
    sizeBytes: ev.sizeBytes,
    isPaymentProof: ev.isPaymentProof,
    sensitive: ev.sensitive,
    uploadedBy: {
      id: ev.uploadedBy.id,
      name: ev.uploadedBy.user.name,
    },
    createdAt: ev.createdAt,
  };
}
