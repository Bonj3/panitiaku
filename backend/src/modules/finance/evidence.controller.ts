import { Request, Response } from "express";
import { z } from "zod";
import {
  NotFoundError,
  UnauthorizedError,
  UnprocessableError,
} from "../../shared/errors/app-error.js";
import {
  uploadEvidence,
  getEvidenceSignedUrl,
  updateEvidenceSensitive,
  listEvidenceForTransaction,
} from "./evidence.service.js";
import {
  uploadEvidenceSchema,
  type UploadEvidenceInput,
  evidenceSensitiveSchema,
  type EvidenceSensitiveInput,
  evidenceUrlQuerySchema,
  type EvidenceUrlQuery,
} from "./evidence.validator.js";
import { validateFile } from "../../shared/utils/file-validation.js";

function parseUuidParam(req: Request, name: string): string {
  const v = req.params[name];
  if (typeof v !== "string" || !z.string().uuid().safeParse(v).success) {
    throw new NotFoundError("Resource tidak ditemukan");
  }
  return v;
}

function requireMembershipId(req: Request): string {
  const m = req.membership;
  if (!m) {
    throw new UnauthorizedError("Keanggotaan event tidak tersedia");
  }
  return m.id;
}

/**
 * Validasi berkas multipart sebelum unggah. Memeriksa ukuran, magic bytes MIME,
 * dan konsistensi ekstensi. Melempar UnprocessableError (422) bila tidak valid.
 */
function validateUploadedFile(req: Request): {
  mimeType: string;
  extension: string;
  originalName: string;
  size: number;
} {
  const file = (req as Request & { file?: { buffer?: Buffer; originalname: string; size: number } }).file;
  if (!file) {
    throw new UnprocessableError("Field berkas 'file' wajib diisi", {
      details: { field: "file", reason: "required" },
    });
  }

  const buffer = file.buffer ?? Buffer.from([]);
  const { mimeType, extension } = validateFile({
    originalName: file.originalname,
    size: file.size,
    buffer,
  });

  return {
    mimeType,
    extension,
    originalName: file.originalname,
    size: file.size,
  };
}

export const evidenceController = {
  async upload(req: Request, res: Response): Promise<void> {
    const eventId = parseUuidParam(req, "eventId");
    const txId = parseUuidParam(req, "txId");
    const actorId = requireMembershipId(req);

    const input = uploadEvidenceSchema.parse(req.body) as UploadEvidenceInput;
    const { mimeType, originalName, size } = validateUploadedFile(req);

    const file = (req as Request & { file?: { buffer?: Buffer; originalname: string; size: number } }).file!;
    const buffer = file.buffer ?? Buffer.from([]);

    const data = await uploadEvidence(eventId, txId, actorId, {
      fileKey: "", // akan diganti di service (generateFileKey)
      originalName,
      mimeType,
      sizeBytes: size,
      buffer,
    }, input.isPaymentProof ?? false);

    res.status(201).json({ success: true, data });
  },

  async getUrl(req: Request, res: Response): Promise<void> {
    const eventId = parseUuidParam(req, "eventId");
    const txId = parseUuidParam(req, "txId");
    const evidenceId = parseUuidParam(req, "evidenceId");
    const actorId = requireMembershipId(req);

    const query = evidenceUrlQuerySchema.parse(req.query) as EvidenceUrlQuery;

    const data = await getEvidenceSignedUrl(
      eventId,
      txId,
      evidenceId,
      actorId,
      query.ttlSeconds
    );

    // Respons tidak pernah menyertakan fileKey.
    res.status(200).json({
      success: true,
      data: {
        url: data.url,
        expiresAt: data.expiresAt,
        evidence: {
          id: data.evidence.id,
          originalName: data.evidence.originalName,
          mimeType: data.evidence.mimeType,
          sizeBytes: data.evidence.sizeBytes,
          isPaymentProof: data.evidence.isPaymentProof,
          sensitive: data.evidence.sensitive,
          uploadedBy: data.evidence.uploadedBy,
          createdAt: data.evidence.createdAt,
        },
      },
    });
  },

  async updateSensitive(req: Request, res: Response): Promise<void> {
    const eventId = parseUuidParam(req, "eventId");
    const txId = parseUuidParam(req, "txId");
    const evidenceId = parseUuidParam(req, "evidenceId");
    const actorId = requireMembershipId(req);

    const input = evidenceSensitiveSchema.parse(
      req.body
    ) as EvidenceSensitiveInput;

    const data = await updateEvidenceSensitive(
      eventId,
      txId,
      evidenceId,
      actorId,
      input.sensitive
    );

    res.status(200).json({ success: true, data });
  },

  async list(req: Request, res: Response): Promise<void> {
    const eventId = parseUuidParam(req, "eventId");
    const txId = parseUuidParam(req, "txId");
    const data = await listEvidenceForTransaction(eventId, txId);
    res.status(200).json({ success: true, data: { items: data } });
  },
};
