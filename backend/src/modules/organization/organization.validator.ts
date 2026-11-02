import { z } from "zod";

const uuid = z.string().uuid("ID tidak valid");

export const listMembersQuerySchema = z.object({
  page: z.coerce
    .number()
    .int()
    .min(1, "Halaman minimal 1")
    .default(1),
  perPage: z.coerce
    .number()
    .int()
    .min(1, "Per halaman minimal 1")
    .max(100, "Per halaman maksimal 100")
    .default(20),
  q: z.string().max(100, "Pencarian maksimal 100 karakter").optional(),
  role: z
    .enum(["EVENT_CHAIR", "DIVISION_LEADER", "MEMBER"], {
      message: "Role tidak valid",
    })
    .optional(),
  status: z
    .enum(["ACTIVE", "INACTIVE"], { message: "Status tidak valid" })
    .optional(),
});

export const updateStatusSchema = z.object({
  status: z.enum(["ACTIVE", "INACTIVE"], {
    message: "Status harus ACTIVE atau INACTIVE",
  }),
});

export const updateRoleSchema = z.object({
  role: z.enum(["DIVISION_LEADER", "MEMBER"], {
    message: "Role harus DIVISION_LEADER atau MEMBER",
  }),
});

export const moveSchema = z.object({
  newParentId: uuid,
});

export type ListMembersQuery = z.infer<typeof listMembersQuerySchema>;
export type UpdateStatusInput = z.infer<typeof updateStatusSchema>;
export type UpdateRoleInput = z.infer<typeof updateRoleSchema>;
export type MoveInput = z.infer<typeof moveSchema>;
