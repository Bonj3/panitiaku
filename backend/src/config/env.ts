import { config } from "dotenv";
import { z } from "zod";

config();

const envSchema = z.object({
  DATABASE_URL: z.string().url("DATABASE_URL harus berupa URL PostgreSQL yang valid"),
  SESSION_SECRET: z.string().min(32, "SESSION_SECRET minimal 32 karakter"),
  CORS_ORIGIN: z.string().min(1, "CORS_ORIGIN wajib diisi (allowlist)"),
  PORT: z.string().regex(/^\d+$/, "PORT harus berupa angka").transform((val) => Number(val)),
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  /**
   * Jumlah hop reverse proxy yang dipercaya untuk menentukan req.ip.
   * 0 = jangan percaya X-Forwarded-For sama sekali (default, aman untuk
   * akses langsung). Set 1 bila backend berada di balik satu reverse proxy
   * (nginx/Caddy/ALB) yang menulis X-Forwarded-For.
   */
  TRUST_PROXY_HOPS: z
    .string()
    .regex(/^\d+$/, "TRUST_PROXY_HOPS harus bilangan bulat >= 0")
    .default("0")
    .transform((val) => Number(val)),

  // Storage (S3-compatible) — semua opsional, tapi jika ada satu yang diisi
  // maka semuanya wajib diisi (all-or-none). Kosong = storage tidak tersedia,
  // rute evidence gagal closed tapi backend tetap nyala.
  S3_ENDPOINT: z.string().url("S3_ENDPOINT harus URL yang valid").optional(),
  S3_REGION: z.string().min(1, "S3_REGION wajib diisi bila S3 diaktifkan").optional(),
  S3_BUCKET: z.string().min(1, "S3_BUCKET wajib diisi bila S3 diaktifkan").optional(),
  S3_ACCESS_KEY_ID: z.string().min(1, "S3_ACCESS_KEY_ID wajib diisi bila S3 diaktifkan").optional(),
  S3_SECRET_ACCESS_KEY: z
    .string()
    .min(1, "S3_SECRET_ACCESS_KEY wajib diisi bila S3 diaktifkan")
    .optional(),
  S3_FORCE_PATH_STYLE: z
    .string()
    .optional()
    .transform((val) => val === "true" || val === "1"),
});

const _parse = envSchema.safeParse(process.env);

if (!_parse.success) {
  console.error(
    "[env] Variabel lingkungan tidak valid:\n",
    _parse.error.flatten().fieldErrors
  );
  process.exit(1);
}

const data = _parse.data;

/**
 * uraikan CORS_ORIGIN menjadi daftar origin asli (dikoma, di-trim, kosong diabaikan).
 * Diekspor agar dapat diuji terpisah dari boot.
 */
export function parseCorsOrigin(value: string): string[] {
  return value.split(",").map((o) => o.trim()).filter(Boolean);
}

/**
 * Tolak wildcard `*` pada CORS_ORIGIN. Credentials (cookie) tidak boleh
 * bersama origin wildcard; fail-fast saat boot bila terdeteksi.
 * Diekspor agar dapat diuji terpisah dari boot.
 */
export function validateCorsOrigin(origins: string[]): void {
  if (origins.some((o) => o === "*")) {
    throw new Error(
      "CORS_ORIGIN dilarang bernilai '*' (wildcard). Isi allowlist origin eksplisit, contoh: http://localhost:5173,https://app.example.com"
    );
  }
}

// CORS_ORIGIN=* ditolak saat boot (fail-fast). Jangan pernah mencetak nilai
// mentah CORS_ORIGIN ke log (bisa berisi origin internal/PII konfigurasi).
const corsOrigins = parseCorsOrigin(data.CORS_ORIGIN);
try {
  validateCorsOrigin(corsOrigins);
} catch {
  console.error(
    "[env] Konfigurasi CORS_ORIGIN tidak valid: origin wildcard '*' dilarang " +
      "bersama credentials. Isi allowlist origin eksplisit di CORS_ORIGIN."
  );
  process.exit(1);
}

// Validasi all-or-none untuk storage env.
const storageKeys = [
  "S3_ENDPOINT",
  "S3_REGION",
  "S3_BUCKET",
  "S3_ACCESS_KEY_ID",
  "S3_SECRET_ACCESS_KEY",
] as const;
const present = storageKeys.filter((k) => data[k] !== undefined && data[k] !== "");
if (present.length > 0 && present.length < storageKeys.length) {
  console.error(
    "[env] Storage S3 harus diisi seluruhnya atau sekaligus kosong. Ada yang bagiannya: " +
      present.join(", ")
  );
  process.exit(1);
}

export const env = _parse.data;

export type Env = z.infer<typeof envSchema>;
