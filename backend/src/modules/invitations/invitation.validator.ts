import { z } from "zod";

const uuid = z.string().uuid("ID tidak valid");

export const createInvitationSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, "Email harus diisi")
    .max(255, "Email maksimal 255 karakter")
    .email("Email tidak valid")
    .transform((val) => val.toLowerCase()),
  role: z
    .enum(["DIVISION_LEADER", "MEMBER"], {
      message: "Role harus DIVISION_LEADER atau MEMBER",
    }),
  parentId: uuid,
});

export const listInvitationsQuerySchema = z.object({
  page: z.coerce.number().int().min(1, "Halaman minimal 1").default(1),
  perPage: z
    .coerce
    .number()
    .int()
    .min(1, "Per halaman minimal 1")
    .max(100, "Per halaman maksimal 100")
    .default(20),
  status: z
    .enum(["PENDING", "ACCEPTED", "REVOKED", "EXPIRED"], {
      message: "Status tidak valid",
    })
    .optional(),
});

export type CreateInvitationInput = z.infer<typeof createInvitationSchema>;
export type ListInvitationsQuery = z.infer<typeof listInvitationsQuerySchema>;
