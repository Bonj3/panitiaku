const MAX_NOTE_LEN = 1000;

/** Pola email sederhana (untuk deteksi PII dalam catatan bebas). */
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

/** Pola URL dengan query token (mis. ?token=, ?access_token=, ?key=). */
const URL_WITH_TOKEN_RE = /https?:\/\/[^\s]+[?&](?:token|access_token|api_key|secret|key)=[^\s]+/gi;

/** Pola nomor telepon (7-15 digit, dengan pemisah opsional). */
const PHONE_RE = /(?<!\d)(?:\+?62|0)?\s*[\d\s().-]{7,15}(?!\d)/g;

/** Pola nomor rekening/ID panjang (8-20 digit berurunan). */
const LONG_DIGIT_RE = /(?<!\d)\d{8,20}(?!\d)/g;

/**
 * Redaksi PII dari catatan bebas (transaction_history.note,
 * financial_transactions.rejectReason, ledger_entries.narration).
 *
 * Redaksi:
 *  - Email → [EMAIL_DISANDINGKAN]
 *  - URL dengan query token → [URL_TOKEN_DISANDINGKAN]
 *  - Nomor telepon → digit tengah disamarkan, tetap terlihat pola nomor
 *  - Nomor rekening/ID panjang 8-20 digit → digit tengah disamarkan
 *
 * Hasil maksimal MAX_NOTE_LEN karakter (dipotong dari tengah bila lebih).
 * Tidak membuang seluruh isi; teks yang sudah di-redaksi tetap bisa dibaca.
 */
export function redactNote(input: string | null | undefined): string | null {
  if (input == null) return null;
  let s = String(input);

  // 1. URL dengan query token (paling spesifik, dulu).
  s = s.replace(URL_WITH_TOKEN_RE, '[URL_TOKEN_DISANDINGKAN]');

  // 2. Email.
  s = s.replace(EMAIL_RE, '[EMAIL_DISANDINGKAN]');

  // 3. Nomor telepon: samarkan digit tengah, jaga pemisah non-digit.
  s = s.replace(PHONE_RE, (m) => {
    const digits = m.replace(/\D/g, '');
    if (digits.length < 7) return m;
    const keepStart = 2;
    const keepEnd = 2;
    let masked = '';
    let dIdx = 0;
    for (const ch of m) {
      if (/\d/.test(ch)) {
        if (dIdx < keepStart || dIdx >= digits.length - keepEnd) {
          masked += ch;
        } else {
          masked += '*';
        }
        dIdx++;
      } else {
        masked += ch;
      }
    }
    return masked;
  });

  // 4. Nomor rekening/ID panjang 8-20 digit: samarkan digit tengah.
  s = s.replace(LONG_DIGIT_RE, (m) => {
    const len = m.length;
    const keep = 2; // tampilkan 2 digit awal dan 2 digit akhir
    const masked = m.slice(0, keep) + '*'.repeat(len - 2 * keep) + m.slice(-keep);
    return masked;
  });

  // Potong dari tengah bila melebihi batas, tandai dengan elipsis.
  if (s.length > MAX_NOTE_LEN) {
    const half = Math.floor((MAX_NOTE_LEN - 3) / 2);
    s = s.slice(0, half) + '...' + s.slice(-half);
  }

  return s;
}

/** Daftar nama field yang diizinkan dalam metadata audit `fields` (array). */
export const AUDIT_FIELDS_WHITELIST = new Set([
  'type',
  'category',
  'description',
  'amount',
  'status',
  'role',
  'parentId',
  'sensitive',
]);

/** MIME type yang diizinkan dalam metadata audit. */
export const AUDIT_MIME_WHITELIST = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
]);

/** Role enum yang aman dalam metadata audit (hanya dari aplikasi, bukan input bebas pengguna). */
export const AUDIT_ROLE_ENUM = new Set(['EVENT_CHAIR', 'DIVISION_LEADER', 'MEMBER']);

/** UUID regex (versi apa pun). */
const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/**
 * Validasi dan normalisasi satu nilai metadata audit agar hanya berisi
 * nilai aman, type-checked, tanpa PII. Mengembalikan null bila nilai
 * tidak boleh disimpan.
 */
export function sanitizeMetaValue(key: string, value: unknown): unknown {
  // Boolean dan null boleh langsung.
  if (typeof value === 'boolean' || value === null) return value;

  // Angka: hanya finite, non-negatif, dibatasi.
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0 || value > 1e12) return null;
    return value;
  }

  // String: validasi berdasarkan kunci.
  if (typeof value === 'string') {
    switch (key) {
      case 'fromStatus':
      case 'toStatus': {
        const allowed = new Set([
          'DRAFT',
          'SUBMITTED',
          'APPROVED',
          'REJECTED',
          'PAID',
          'CANCELLED',
          'PENDING',
          'ACCEPTED',
          'REVOKED',
          'EXPIRED',
          // Status keanggotaan (member.status.update) — hanya ACTIVE/INACTIVE.
          'ACTIVE',
          'INACTIVE',
        ]);
        return allowed.has(value) ? value : null;
      }
      case 'fromRole':
      case 'toRole':
      case 'role': {
        // Hanya role enum aplikasi; string bebas ditolak.
        return AUDIT_ROLE_ENUM.has(value) ? value : null;
      }
      case 'mimeType':
        return AUDIT_MIME_WHITELIST.has(value) ? value : null;
      case 'trigger': {
        const allowedTrigger = new Set(['automatic_ttl', 'manual']);
        return allowedTrigger.has(value) ? value : null;
      }
      default:
        // String numerik (desimal) untuk jumlah uang — aman, bukan PII.
        if (/^\d+(\.\d+)?$/.test(value)) return value;
        // Kode enum singkat (huruf besar, angka, garis bawah, titik, hubung)
        // untuk kunci seperti type/category/currency/status yang nilainya
        // berasal dari whitelist aplikasi, bukan input bebas pengguna.
        if (/^[A-Z][A-Z0-9_.-]*$/.test(value)) return value;
        // ID / UUID: hanya jika valid UUID.
        if (UUID_RE.test(value)) return value;
        // String sembarang yang bukan kunci whitelist → tolak.
        return null;
    }
  }

  // Array: hanya `fields` dengan nama field whitelist.
  if (Array.isArray(value)) {
    if (key !== 'fields') return null;
    return value
      .filter((x): x is string => typeof x === 'string' && AUDIT_FIELDS_WHITELIST.has(x))
      .slice(0, 20);
  }

  // Objek bersarang tidak diizinkan.
  return null;
}

/**
 * Sanitasi metadata audit: hapus kunci non-whitelist, validasi setiap nilai,
 * dan kembalikan null bila hasil kosong.
 */
export function sanitizeAuditMetadata(
  metadata: Record<string, unknown> | null | undefined,
  allowedKeys: Set<string>
): Record<string, unknown> | null {
  if (!metadata) return null;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(metadata)) {
    if (!allowedKeys.has(k)) continue;
    const clean = sanitizeMetaValue(k, v);
    if (clean === null || clean === undefined) continue;
    out[k] = clean;
  }
  return Object.keys(out).length > 0 ? out : null;
}

export { MAX_NOTE_LEN };
