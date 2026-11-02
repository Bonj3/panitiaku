import type { Prisma } from "../../generated/prisma/client.js";

export type EvidenceMimeType =
  | "image/jpeg"
  | "image/png"
  | "application/pdf"
  | "image/webp";

export interface EvidenceMetadata {
  id: string;
  transactionId: string;
  originalName: string;
  mimeType: EvidenceMimeType;
  sizeBytes: number;
  isPaymentProof: boolean;
  sensitive: boolean;
  uploadedBy: { id: string; name: string };
  createdAt: Date;
  // fileKey sengaja dikecualikan dari response publik (tidak pernah dikirim ke klien)
}

export type EvidenceWithUploader = Prisma.TransactionEvidenceGetPayload<{
  include: { uploadedBy: { include: { user: true } } };
}>;

export function toEvidenceMetadata(
  ev: EvidenceWithUploader
): EvidenceMetadata {
  return {
    id: ev.id,
    transactionId: ev.transactionId,
    originalName: ev.originalName,
    mimeType: ev.mimeType as EvidenceMimeType,
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
