import { z } from "zod";

/**
 * Skema form event. Diselaraskan dengan validator backend
 * (`backend/src/modules/events/event.validator.ts`) agar pesan validasi
 * konsisten sebelum request dikirim.
 */

const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const createEventSchema = z.object({
  name: z
    .string()
    .trim()
    .min(3, "Nama event minimal 3 karakter")
    .max(150, "Nama event maksimal 150 karakter"),
  slug: z
    .string()
    .trim()
    .max(180, "Slug maksimal 180 karakter")
    .regex(
      slugPattern,
      "Slug hanya boleh berisi huruf kecil, angka, dan pemisah '-' (tanpa awalan/akhiran '-')",
    )
    .optional()
    .or(z.literal("")),
  description: z
    .string()
    .max(2000, "Deskripsi maksimal 2000 karakter")
    .optional()
    .or(z.literal("")),
});

export type CreateEventFormData = z.infer<typeof createEventSchema>;

export const updateEventSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(3, "Nama event minimal 3 karakter")
      .max(150, "Nama event maksimal 150 karakter")
      .optional()
      .or(z.literal("")),
    description: z
      .string()
      .max(2000, "Deskripsi maksimal 2000 karakter")
      .optional()
      .or(z.literal("")),
  })
  .refine(
    (data) =>
      (data.name !== undefined && data.name !== "") ||
      (data.description !== undefined && data.description !== ""),
    {
      message: "Minimal satu field (nama atau deskripsi) harus diisi",
    },
  );

export type UpdateEventFormData = z.infer<typeof updateEventSchema>;
