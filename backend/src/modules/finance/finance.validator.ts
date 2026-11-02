import { z } from 'zod';

export const TxCategoryWhitelist: Record<string, string[]> = {
  INCOME: ['SPONSORSHIP', 'TICKETING', 'DONATION', 'OTHER_INCOME'],
  EXPENSE: [
    'VENUE',
    'CONSUMPTION',
    'EQUIPMENT',
    'TRANSPORT',
    'HONORARIUM',
    'PRINTING',
    'OTHER_EXPENSE',
  ],
};

/**
 * Validasi amount: > 0, maksimal 2 desimal, integer maksimal 17 digit
 * (cocok NUMERIC(19,2): 19 digit total − 2 desimal = 17 digit integer).
 * Terima number/string, kirim ke Prisma sebagai string.
 */
export const amountSchema = z
  .preprocess(
    (val) => {
      if (typeof val === 'number') return String(val);
      if (typeof val === 'string') return val.trim();
      return val;
    },
    z
      .string()
      .regex(
        /^\d{1,17}(\.\d{1,2})?$/,
        'Amount harus angka positif maksimal 17 digit integer dan 2 desimal'
      )
      .refine((s) => parseFloat(s) > 0, 'Amount harus lebih besar dari 0')
  )
  .transform((s) => s);

export const createTransactionSchema = z.object({
  type: z.enum(['INCOME', 'EXPENSE']),
  category: z
    .string()
    .trim()
    .min(1, 'Kategori wajib diisi')
    .max(50, 'Kategori maksimal 50 karakter'),
  description: z.string().trim().min(1, 'Deskripsi wajib diisi').max(1000),
  amount: amountSchema,
  currency: z.literal('IDR').optional(),
});

export const updateTransactionSchema = z
  .object({
    type: z.enum(['INCOME', 'EXPENSE']).optional(),
    category: z.string().trim().min(1).max(50).optional(),
    description: z.string().trim().min(1).max(1000).optional(),
    amount: amountSchema.optional(),
  })
  .refine(
    (data) =>
      data.type !== undefined ||
      data.category !== undefined ||
      data.description !== undefined ||
      data.amount !== undefined,
    {
      message: 'Minimal satu field harus diisi',
      path: [],
    }
  );

export const submitTransactionSchema = z.object({});

export const approveTransactionSchema = z.object({});

export const rejectTransactionSchema = z.object({
  reason: z.string().trim().min(3, 'Alasan penolakan minimal 3 karakter'),
});

export const payTransactionSchema = z.object({
  narration: z.string().trim().max(1000).optional().nullable(),
});

export const cancelTransactionSchema = z.object({
  reason: z.string().trim().max(1000).optional().nullable(),
});

export const reverseTransactionSchema = z.object({
  reason: z.string().trim().min(3, 'Alasan reversi minimal 3 karakter'),
});

export const reopenTransactionSchema = z.object({});

export const listTransactionsQuerySchema = z.object({
  status: z.enum(['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'PAID', 'CANCELLED']).optional(),
  type: z.enum(['INCOME', 'EXPENSE']).optional(),
  category: z.string().max(50, 'Kategori maksimal 50 karakter').optional(),
  q: z.string().max(100, 'Pencarian maksimal 100 karakter').optional(),
  page: z
    .string()
    .regex(/^\d+$/, 'Page harus angka')
    .transform((s) => Math.max(1, parseInt(s, 10)))
    .default(1),
  perPage: z
    .string()
    .regex(/^\d+$/, 'perPage harus angka')
    .transform((s) => Math.min(100, Math.max(1, parseInt(s, 10))))
    .default(20),
});

export type CreateTransactionInput = z.infer<typeof createTransactionSchema>;
export type UpdateTransactionInput = z.infer<typeof updateTransactionSchema>;
export type SubmitTransactionInput = z.infer<typeof submitTransactionSchema>;
export type ApproveTransactionInput = z.infer<typeof approveTransactionSchema>;
export type RejectTransactionInput = z.infer<typeof rejectTransactionSchema>;
export type PayTransactionInput = z.infer<typeof payTransactionSchema>;
export type CancelTransactionInput = z.infer<typeof cancelTransactionSchema>;
export type ReverseTransactionInput = z.infer<typeof reverseTransactionSchema>;
export type ReopenTransactionInput = z.infer<typeof reopenTransactionSchema>;
export type ListTransactionsQuery = z.infer<typeof listTransactionsQuerySchema>;
