import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Token acak opaque 32 byte (256 bit) dalam encoding base64url.
 * Digunakan sebagai identifier sesi yang dikirim ke klien melalui cookie;
 * yang disimpan di database hanyalah hash-nya (lihat hashToken).
 */
export function generateOpaqueToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * Hash SHA-256 (hex) dari token opaque. Hanya hash yang menyentuh database,
 * sehingga kebocoran database tidak langsung mengungkap token sesi asli.
 */
export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/**
 * Perbandingan konstan waktu untuk mencegah timing attack.
 * Harus digunakan hanya membandingkan nilai yang sama panjangnya;
 * nilai dengan panjang berbeda langsung false tanpa memanggil timingSafeEqual
 * (yang akan melempar untuk panjang yang tidak sama).
 */
export function constantTimeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) {
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}
