/**
 * Antara penyimpanan objek privat (PROJECT §5.C, OD-11).
 *
 * Implementasi konkret: S3-compatible adapter (MinIO / S3 / Supabase Storage
 * via S3 gateway). Bucket selalu private; akses hanya via signed URL.
 * Tidak ada URL publik, tidak ada penyimpanan di disk lokal pada production.
 */
export interface StorageProvider {
  /**
   * Unggah objek privat. Mengembalikan key objek yang tersimpan.
   * Gagal bila provider tidak terkonfigurasi (fail closed).
   */
  put(params: {
    key: string;
    body: Buffer | NodeJS.ReadableStream;
    contentType: string;
  }): Promise<{ key: string }>;

  /**
   * Hapus objek (hanya untuk kompensasi saat gagal setelah unggah).
   * Tidak boleh dipakai untuk "hapus bukti" alur biasa.
   */
  delete(params: { key: string }): Promise<void>;

  /**
   * Buat signed URL dengan TTL (detik). Mengembalikan URL dan waktu kedaluwarsa.
   * Gagal bila provider tidak terkonfigurasi (fail closed).
   */
  signedGetUrl(params: {
    key: string;
    ttlSeconds?: number;
  }): Promise<{ url: string; expiresAt: Date }>;

  /**
   * Apakah provider tersedia dan terkonfigurasi.
   */
  isAvailable(): boolean;
}
