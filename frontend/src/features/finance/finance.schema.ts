import { z } from "zod";
import {
  ALL_TRANSACTION_CATEGORIES,
  TRANSACTION_CATEGORIES,
} from "./finance.types";

/**
 * Validasi form transaksi, selaras dengan
 * `backend/src/modules/finance/finance.validator.ts`:
 * amount > 0, maksimal 17 digit integer + 2 desimal, kategori cocok tipe.
 *
 * Amount tetap string - jangan dikonversi ke number/float.
 */

const AMOUNT_PATTERN = /^\d{1,17}(\.\d{1,2})?$/;

function isPositiveAmount(value: string): boolean {
  const [integerPart, decimalPart = ""] = value.split(".");
  return /[1-9]/.test(integerPart) || /[1-9]/.test(decimalPart);
}

export const transactionFormSchema = z
  .object({
    type: z.enum(["INCOME", "EXPENSE"], {
      message: "Tipe transaksi wajib dipilih",
    }),
    category: z.enum(ALL_TRANSACTION_CATEGORIES, {
      message: "Kategori wajib dipilih",
    }),
    description: z
      .string()
      .trim()
      .min(1, "Deskripsi wajib diisi")
      .max(1000, "Deskripsi maksimal 1000 karakter"),
    amount: z
      .string()
      .trim()
      .min(1, "Nominal wajib diisi")
      .regex(
        AMOUNT_PATTERN,
        "Nominal harus angka positif, maksimal 17 digit dan 2 desimal",
      )
      .refine(isPositiveAmount, "Nominal harus lebih besar dari 0"),
  })
  .superRefine((data, ctx) => {
    const allowed: readonly string[] = TRANSACTION_CATEGORIES[data.type];
    if (!allowed.includes(data.category)) {
      ctx.addIssue({
        code: "custom",
        path: ["category"],
        message: "Kategori tidak cocok dengan tipe transaksi",
      });
    }
  });

export type TransactionFormData = z.infer<typeof transactionFormSchema>;

/**
 * Bersihkan input nominal saat mengetik/paste: hanya digit + pemisah desimal,
 * maksimal 17 digit integer dan 2 desimal. Pemisah ribuan yang ikut ter-paste
 * (mis. "1.234.567" atau "1.234.567,89") dirapikan tanpa mengubah ke number.
 */
export function sanitizeAmountInput(raw: string): string {
  const cleaned = raw.replace(/[^\d.,]/g, "").replace(/,/g, ".");
  if (!cleaned) return "";

  const parts = cleaned.split(".");
  let integerPart: string;
  let decimalPart: string;

  if (parts.length > 2) {
    const last = parts[parts.length - 1];
    if (last.length > 0 && last.length <= 2) {
      integerPart = parts.slice(0, -1).join("");
      decimalPart = last;
    } else {
      integerPart = parts.join("");
      decimalPart = "";
    }
  } else {
    integerPart = parts[0] ?? "";
    decimalPart = parts[1] ?? "";
  }

  integerPart = integerPart.slice(0, 17);
  decimalPart = decimalPart.slice(0, 2);

  if (parts.length === 1) return integerPart;
  return `${integerPart === "" ? "0" : integerPart}.${decimalPart}`;
}
