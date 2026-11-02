import { toFriendlyMessage } from "@/components/shared/ErrorState";
import { ApiError } from "@/lib/api-client";

/**
 * Terjemahan error backend ke pesan Indonesia yang ramah untuk konteks
 * keuangan. Pesan backend sudah berbahasa Indonesia; helper ini menambah
 * konteks pada konflik status (409) dan kasus lintas-event (404).
 */
export function toFriendlyFinanceError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 404) {
      return "Transaksi tidak ditemukan pada event ini.";
    }
    if (error.status === 409) {
      return `${error.message} Data transaksi akan dimuat ulang agar status terbaru terlihat.`;
    }
    if (error.status === 401) {
      return "Sesi Anda berakhir. Silakan masuk kembali.";
    }
    return error.message;
  }
  return toFriendlyMessage(error);
}

/** True bila error adalah konflik status (409) dari backend. */
export function isFinanceConflict(error: unknown): boolean {
  return error instanceof ApiError && error.status === 409;
}
