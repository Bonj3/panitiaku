import { z } from "zod";

/**
 * Skema form buat undangan. Diselaraskan dengan validator backend
 * (`backend/src/modules/invitations/invitation.validator.ts`):
 * email (trim, lowercase) + role enum + parentId uuid wajib.
 */
export const createInvitationSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, "Email wajib diisi")
    .max(255, "Email maksimal 255 karakter")
    .email("Email tidak valid")
    .transform((value) => value.toLowerCase()),
  role: z.enum(["DIVISION_LEADER", "MEMBER"], {
    message: "Peran harus Ketua Divisi atau Anggota",
  }),
  parentId: z
    .string()
    .min(1, "Atasan wajib dipilih")
    .uuid("Atasan tidak valid"),
});

export type CreateInvitationFormData = z.infer<typeof createInvitationSchema>;
