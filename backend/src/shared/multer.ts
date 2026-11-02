import multer from "multer";
import { MAX_FILE_SIZE } from "./utils/file-validation.js";

/**
 * Konfigurasi Multer untuk unggah bukti transaksi.
 *
 * - Memory storage: berkas hanya di RAM (tidak tertulis ke disk lokal),
 *   sesuai kebijakan "tidak menyimpan berkas di disk lokal production".
 * - Limit ukuran: 10 MiB (OD-7). Melebihi → Multer error → dipetakan 413
 *   oleh error-handler.
 * - Hanya satu field `file`.
 */
export const multerUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_FILE_SIZE,
    files: 1,
  },
});
