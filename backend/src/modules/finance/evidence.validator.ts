import { z } from "zod";

export const uploadEvidenceSchema = z.object({
  isPaymentProof: z
    .preprocess((val) => val === true || val === "true", z.boolean().optional())
    .default(false),
});

export type UploadEvidenceInput = z.infer<typeof uploadEvidenceSchema>;

export const evidenceSensitiveSchema = z.object({
  sensitive: z.boolean(),
});

export type EvidenceSensitiveInput = z.infer<typeof evidenceSensitiveSchema>;

export const evidenceUrlQuerySchema = z.object({
  ttlSeconds: z
    .string()
    .regex(/^\d+$/, "TTL harus angka detik")
    .transform((s) => {
      const v = parseInt(s, 10);
      // PROJECT §5.C / OD-7: signed URL berumur 5–15 menit, default 10 menit
      // (600 detik). Rentang yang diterima adalah 300–900 detik; nilai di
      // luar rentang di-clamp agar URL tidak pernah diterbitkan di luar
      // 5–15 menit. Sebelumnya batas bawah 60 detik (bertentangan dengan
      // spesifikasi 5 menit = 300 detik).
      return Math.min(900, Math.max(300, v)); // 5 menit – 15 menit
    })
    .optional()
    .default(600),
});

export type EvidenceUrlQuery = z.infer<typeof evidenceUrlQuerySchema>;
