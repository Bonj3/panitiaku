import { z } from "zod";

export const createEventSchema = z.object({
  name: z
    .string()
    .trim()
    .min(3, "Nama event minimal 3 karakter")
    .max(150, "Nama event maksimal 150 karakter"),
  slug: z
    .string()
    .regex(
      /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
      "Slug hanya boleh berisi huruf kecil, angka, dan pemisah '-' (tanpa awalan/akhiran '-')",
    )
    .max(180, "Slug maksimal 180 karakter")
    .optional(),
  description: z
    .string()
    .max(2000, "Deskripsi maksimal 2000 karakter")
    .optional()
    .nullable(),
});

export const updateEventSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(3, "Nama event minimal 3 karakter")
      .max(150, "Nama event maksimal 150 karakter")
      .optional(),
    description: z
      .string()
      .max(2000, "Deskripsi maksimal 2000 karakter")
      .optional()
      .nullable(),
  })
  .refine(
    (data) => data.name !== undefined || data.description !== undefined,
    {
      message: "Minimal satu field (name atau description) harus diisi",
      path: [],
    },
  );

export const closeEventSchema = z.object({
  confirm: z.literal(true, {
    message:
      'Harus mengonfirmasi penutupan event dengan field "confirm" bernilai true',
  }),
});

export type CreateEventInput = z.infer<typeof createEventSchema>;
export type UpdateEventInput = z.infer<typeof updateEventSchema>;
export type CloseEventInput = z.infer<typeof closeEventSchema>;
