/**
 * Ubah nama event menjadi slug yang aman untuk URL dan unik-cukup untuk
 * digunakan sebagai nilai awal kolom `events.slug` (VARCHAR 180).
 *
 * Aturan:
 * 1. Lowercase
 * 2. NFKD decomposition, lalu buang karakter diakritik (aksen)
 * 3. Setiap run karakter non-alphanumerik → satu "-"
 * 4. Trim "-" di awal/akhir
 * 5. Potong maksimal 160 karakter
 * 6. Jika hasil kosong → fallback "event"
 */
export function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 160);

  return slug || "event";
}
