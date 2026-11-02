import { UnprocessableError } from '../errors/app-error.js';
import { randomBytes } from 'node:crypto';
import { redactNote } from './pii-redaction.js';

/** Maksimal ukuran berkas: 10 MiB (OD-7). */
export const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10485760

/** MIME type yang diizinkan (whitelist eksak, PROJEK §5.C / OD-7). */
export const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'application/pdf',
  'image/webp',
]);

/** Ekstensi berkas yang diizinkan (lowercase, tanpa titik). */
const ALLOWED_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'pdf', 'webp']);

/** Mapping ekstensi → MIME type yang diharapkan. */
const EXTENSION_TO_MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  pdf: 'application/pdf',
  webp: 'image/webp',
};

/** Deteksi MIME dari magic bytes (awalan berkas). Jangan percaya Content-Type klien. */
export function detectMimeByMagicBytes(buffer: Buffer): string | null {
  if (buffer.length < 4) return null;

  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }

  // PNG: 89 50 4E 47
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    return 'image/png';
  }

  // PDF: 25 50 44 46 (%PDF)
  if (buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46) {
    return 'application/pdf';
  }

  // WebP: RIFF (0-3) + WEBP (8-11)
  if (
    buffer.length >= 12 &&
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  ) {
    return 'image/webp';
  }

  return null;
}

/** Ekstrak ekstensi dari nama berkas, hapus path traversal, lowercase. */
export function extractExtension(originalName: string): string | null {
  // Strip semua path (hanya ambil nama berchas terakhir)
  const baseName = originalName.replace(/\\/g, '/').split('/').pop() ?? '';
  const lastDot = baseName.lastIndexOf('.');
  if (lastDot <= 0 || lastDot === baseName.length - 1) return null;
  return baseName.slice(lastDot + 1).toLowerCase();
}

/**
 * Validasi berkas lengkap: ukuran, MIME magic bytes, konsistensi ekstensi vs MIME.
 * Melempar UnprocessableError (422) bila tidak valid.
 */
export function validateFile({
  originalName,
  size,
  buffer,
}: {
  originalName: string;
  size: number;
  buffer: Buffer;
}): { mimeType: string; extension: string } {
  if (!size || size <= 0) {
    throw new UnprocessableError('Berkas kosong tidak diizinkan', {
      details: { field: 'file', reason: 'empty' },
    });
  }

  if (size > MAX_FILE_SIZE) {
    throw new UnprocessableError(
      `Berkas melebihi batas ${Math.floor(MAX_FILE_SIZE / 1024 / 1024)} MiB`,
      { details: { field: 'file', reason: 'too_large', maxBytes: MAX_FILE_SIZE } }
    );
  }

  const extension = extractExtension(originalName);
  if (!extension || !ALLOWED_EXTENSIONS.has(extension)) {
    throw new UnprocessableError('Ekstensi berkas tidak diizinkan', {
      details: {
        field: 'file',
        reason: 'invalid_extension',
        allowed: Array.from(ALLOWED_EXTENSIONS).sort(),
      },
    });
  }

  const detectedMime = detectMimeByMagicBytes(buffer);
  if (!detectedMime || !ALLOWED_MIME_TYPES.has(detectedMime)) {
    throw new UnprocessableError('Tipe berkas tidak valid (magic bytes tidak cocok)', {
      details: { field: 'file', reason: 'invalid_mime' },
    });
  }

  const expectedMime = EXTENSION_TO_MIME[extension];
  if (detectedMime !== expectedMime) {
    throw new UnprocessableError('Ekstensi tidak cocok dengan tipe berkas aktual', {
      details: {
        field: 'file',
        reason: 'extension_mime_mismatch',
        expected: expectedMime,
        detected: detectedMime,
      },
    });
  }

  return { mimeType: detectedMime, extension };
}

/** Panjang maksimal nama berkas asli yang disimpan dan dikirim dalam respons (privacy + DB). */
export const MAX_ORIGINAL_NAME_LEN = 120;

/**
 * Sanitasi nama berkas asli untuk disimpan sebagai metadata dan dikirim dalam
 * setiap respons (tidak pernah ada PII/path traversal di luar sana).
 *
 * Alur:
 *  1. Redaksi PII span (email, telepon, digit panjang/rekening, URL token) via
 *     redactNote — sebelum nama berkas diproses lebih lanjut.
 *  2. Strip path traversal — hanya ambil nama berkas terakhir (basename).
 *  3. Hilangkan karakter berbahaya; simpan alfanumerik, titik, garis bawah,
 *     strip.
 *  4. Batasi panjang sambil jaga ekstensi tetap terbaca.
 */
export function sanitizeOriginalName(originalName: string): string {
  // 1. Redaksi PII (email, telepon, digit panjang, URL token) terlebih dahulu.
  const s = redactNote(originalName) ?? 'upload';

  // 2. Strip semua path — hanya ambil nama berkas terakhir.
  const baseName = s.replace(/\\/g, '/').split('/').pop() ?? 'upload';

  // 3. Hilangkan karakter berbahaya; simpan alfanumerik, titik, garis bawah, strip.
  let clean = baseName.replace(/[^\w._-]/g, '_');

  // 4. Batasi panjang sambil jaga ekstensi tetap terbaca.
  if (clean.length > MAX_ORIGINAL_NAME_LEN) {
    const ext = extractExtension(clean) ?? '';
    const extPart = ext.length ? '.' + ext : '';
    const namePart = clean.slice(0, clean.length - extPart.length);
    const keep = Math.max(0, MAX_ORIGINAL_NAME_LEN - extPart.length - 3);
    clean = namePart.slice(0, keep) + '...' + extPart;
  }

  return clean || 'upload';
}

/** Buat kunci objek acak dan tidak dapat ditebak (opaque). */
export function generateFileKey(): string {
  const bytes = randomBytes(16);
  return bytes.toString('hex');
}
