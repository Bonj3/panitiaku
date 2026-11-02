import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { Dialog } from "@/components/shared/Dialog";
import { toFriendlyFinanceError } from "./finance.errors";
import { sanitizeAmountInput, transactionFormSchema } from "./finance.schema";
import type { TransactionFormData } from "./finance.schema";
import {
  TRANSACTION_CATEGORIES,
  TRANSACTION_CATEGORY_LABEL,
  TRANSACTION_TYPE_LABEL,
} from "./finance.types";
import type {
  TransactionCategory,
  TransactionItem,
  TransactionType,
} from "./finance.types";
import { useCreateTransaction, useUpdateTransaction } from "./use-finance";

const inputClass =
  "mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-500 focus:ring-1 focus:ring-slate-500 focus:outline-none disabled:opacity-60";

interface TransactionFormDialogProps {
  eventId: string;
  mode: "create" | "edit";
  open: boolean;
  /** Wajib untuk mode edit (transaksi DRAFT). */
  initial?: TransactionItem | null;
  onClose: () => void;
  onSaved?: (transaction: TransactionItem) => void;
}

function resolveCategory(
  transaction: TransactionItem | null | undefined,
): TransactionCategory {
  const type: TransactionType = transaction?.type ?? "EXPENSE";
  const allowed = TRANSACTION_CATEGORIES[type];
  const match = allowed.find((category) => category === transaction?.category);
  return match ?? allowed[0];
}

/**
 * Dialog buat/edit transaksi DRAFT.
 * - Amount adalah string (hanya digit + maks 2 desimal), tidak pernah float.
 * - Kategori mengikuti tipe; mata uang tetap IDR (tanpa pilihan USD).
 * - Error 422/409 backend ditampilkan langsung di dialog.
 */
export function TransactionFormDialog({
  eventId,
  mode,
  open,
  initial,
  onClose,
  onSaved,
}: TransactionFormDialogProps) {
  const createMutation = useCreateTransaction(eventId);
  const updateMutation = useUpdateTransaction(eventId);
  const [submitError, setSubmitError] = useState<unknown>(null);

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors },
  } = useForm<TransactionFormData>({
    resolver: zodResolver(transactionFormSchema),
    defaultValues: {
      type: initial?.type ?? "EXPENSE",
      category: resolveCategory(initial),
      description: initial?.description ?? "",
      amount: initial?.amount ?? "",
    },
  });

  // Reset form hanya saat dialog dibuka, bukan setiap query detail refetch.
  useEffect(() => {
    if (!open) return;
    reset({
      type: initial?.type ?? "EXPENSE",
      category: resolveCategory(initial),
      description: initial?.description ?? "",
      amount: initial?.amount ?? "",
    });
    setSubmitError(null);
    createMutation.reset();
    updateMutation.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const selectedType = watch("type");
  const selectedCategory = watch("category");
  const amountValue = watch("amount");
  const pending = createMutation.isPending || updateMutation.isPending;

  const categoryOptions: readonly TransactionCategory[] =
    TRANSACTION_CATEGORIES[selectedType];

  const handleTypeChange = (nextType: TransactionType) => {
    setValue("type", nextType, { shouldValidate: true });
    const allowed: readonly TransactionCategory[] =
      TRANSACTION_CATEGORIES[nextType];
    if (!allowed.some((category) => category === selectedCategory)) {
      setValue("category", allowed[0], { shouldValidate: true });
    }
  };

  const handleClose = () => {
    if (pending) return;
    setSubmitError(null);
    onClose();
  };

  const onSubmit = handleSubmit(async (values) => {
    setSubmitError(null);
    try {
      if (mode === "edit") {
        if (!initial) {
          setSubmitError(new Error("Transaksi yang akan diedit tidak tersedia."));
          return;
        }
        const updated = await updateMutation.mutateAsync({
          transactionId: initial.id,
          input: {
            type: values.type,
            category: values.category,
            description: values.description,
            amount: values.amount,
          },
        });
        onSaved?.(updated);
      } else {
        const created = await createMutation.mutateAsync({
          type: values.type,
          category: values.category,
          description: values.description,
          amount: values.amount,
          currency: "IDR",
        });
        onSaved?.(created);
      }
      onClose();
    } catch (err) {
      setSubmitError(err);
    }
  });

  const amountField = register("amount");

  return (
    <Dialog
      title={mode === "edit" ? "Edit transaksi" : "Transaksi baru"}
      description={
        mode === "edit"
          ? "Perubahan hanya dapat dilakukan pada transaksi berstatus draf."
          : "Catat pemasukan atau pengeluaran event. Transaksi tersimpan sebagai draf."
      }
      open={open}
      onClose={handleClose}
    >
      <form onSubmit={onSubmit} noValidate className="space-y-5">
        {submitError ? (
          <div
            role="alert"
            className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
          >
            {toFriendlyFinanceError(submitError)}
          </div>
        ) : null}

        <div>
          <label
            htmlFor="transaction-type"
            className="block text-sm font-medium text-slate-700"
          >
            Tipe transaksi
          </label>
          <select
            id="transaction-type"
            value={selectedType}
            onChange={(event) =>
              handleTypeChange(event.target.value as TransactionType)
            }
            aria-invalid={Boolean(errors.type)}
            disabled={pending}
            className={inputClass}
          >
            {(
              Object.keys(TRANSACTION_TYPE_LABEL) as TransactionType[]
            ).map((type) => (
              <option key={type} value={type}>
                {TRANSACTION_TYPE_LABEL[type]}
              </option>
            ))}
          </select>
          {errors.type ? (
            <p role="alert" className="mt-1 text-sm text-red-700">
              {errors.type.message}
            </p>
          ) : null}
        </div>

        <div>
          <label
            htmlFor="transaction-category"
            className="block text-sm font-medium text-slate-700"
          >
            Kategori
          </label>
          <select
            id="transaction-category"
            value={selectedCategory}
            onChange={(event) =>
              setValue("category", event.target.value as TransactionCategory, {
                shouldValidate: true,
              })
            }
            aria-invalid={Boolean(errors.category)}
            disabled={pending}
            className={inputClass}
          >
            {categoryOptions.map((category) => (
              <option key={category} value={category}>
                {TRANSACTION_CATEGORY_LABEL[category]}
              </option>
            ))}
          </select>
          {errors.category ? (
            <p role="alert" className="mt-1 text-sm text-red-700">
              {errors.category.message}
            </p>
          ) : null}
        </div>

        <div>
          <label
            htmlFor="transaction-description"
            className="block text-sm font-medium text-slate-700"
          >
            Deskripsi
          </label>
          <textarea
            id="transaction-description"
            rows={3}
            placeholder="Contoh: Sewa gedung untuk acara utama"
            {...register("description")}
            aria-invalid={Boolean(errors.description)}
            disabled={pending}
            className={inputClass}
          />
          {errors.description ? (
            <p role="alert" className="mt-1 text-sm text-red-700">
              {errors.description.message}
            </p>
          ) : null}
        </div>

        <div>
          <label
            htmlFor="transaction-amount"
            className="block text-sm font-medium text-slate-700"
          >
            Nominal (IDR)
          </label>
          <div className="relative mt-1">
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-slate-500"
            >
              Rp
            </span>
            <input
              id="transaction-amount"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              placeholder="1500000"
              maxLength={20}
              {...amountField}
              value={amountValue}
              onChange={(event) =>
                setValue("amount", sanitizeAmountInput(event.target.value), {
                  shouldDirty: true,
                  shouldValidate: false,
                })
              }
              aria-invalid={Boolean(errors.amount)}
              aria-describedby="transaction-amount-hint"
              disabled={pending}
              className={`${inputClass} pl-9 text-right tabular-nums`}
            />
          </div>
          <p
            id="transaction-amount-hint"
            className="mt-1 text-xs text-slate-500"
          >
            Hanya angka, maksimal 2 desimal. Jangan gunakan titik ribuan.
            Mata uang tetap IDR.
          </p>
          {errors.amount ? (
            <p role="alert" className="mt-1 text-sm text-red-700">
              {errors.amount.message}
            </p>
          ) : null}
        </div>

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={handleClose}
            disabled={pending}
            className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-60"
          >
            Batal
          </button>
          <button
            type="submit"
            disabled={pending}
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700 focus-visible:ring-2 focus-visible:ring-slate-500 focus-visible:ring-offset-2 focus-visible:outline-none disabled:opacity-60"
          >
            {pending
              ? "Menyimpan."
              : mode === "edit"
                ? "Simpan perubahan"
                : "Buat transaksi"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
