/**
 * Formatter terpusat: uang (id-ID + prefix Rp) dan tanggal (locale id-ID).
 */

const idrFormatter = new Intl.NumberFormat("id-ID", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const DECIMAL_STRING_PATTERN = /^([+-]?)(\d+)(?:\.(\d*))?$/;

function formatRupiah(absInteger: bigint): string {
  return `Rp${idrFormatter.format(absInteger)}`;
}

/**
 * Format nominal Rupiah secara presisi dari string desimal.
 *
 * Nominal keuangan dari backend adalah string (mis. "1500000.00" atau
 * "-250000.50"). Bagian integer diformat dengan BigInt + Intl.NumberFormat
 * ('id-ID') TANPA melewati float, sehingga nilai besar tetap presisi.
 * Pecahan (maksimal 2 digit dari backend) ditampilkan apa adanya — tidak
 * dibulatkan dan tidak dihitung ulang — agar angka di UI sama dengan ledger.
 *
 * `number` tetap didukung agar pemakaian lama kompatibel.
 */
export function formatCurrency(value: number | string): string {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "Rp0";
    const negative = value < 0;
    if (Number.isInteger(value) && Number.isSafeInteger(value)) {
      const abs = BigInt(Math.abs(value));
      return `${negative && abs > 0n ? "-" : ""}${formatRupiah(abs)}`;
    }
    const rounded = Math.round(Math.abs(value));
    return `${negative && rounded > 0 ? "-" : ""}${formatRupiah(
      BigInt(rounded),
    )}`;
  }

  const match = DECIMAL_STRING_PATTERN.exec(value.trim());
  if (!match) return "Rp0";

  const fraction = match[3] ?? "";
  const integerDigits = match[2].replace(/^0+(?=\d)/, "");

  // Desimal maksimal 2 digit; "00" berarti Rupiah bulat.
  const cents = fraction ? fraction.slice(0, 2).padEnd(2, "0") : "";
  const shownCents = cents === "00" ? "" : cents;

  const abs = BigInt(integerDigits);
  const negative =
    match[1] === "-" && (abs > 0n || shownCents !== "");
  return `${negative ? "-" : ""}${formatRupiah(abs)}${
    shownCents ? `,${shownCents}` : ""
  }`;
}

const dateFormatter = new Intl.DateTimeFormat("id-ID", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

const dateTimeFormatter = new Intl.DateTimeFormat("id-ID", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

function toDate(value: string | Date): Date | null {
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatDate(value: string | Date): string {
  const d = toDate(value);
  return d ? dateFormatter.format(d) : "-";
}

export function formatDateTime(value: string | Date): string {
  const d = toDate(value);
  return d ? dateTimeFormatter.format(d) : "-";
}
