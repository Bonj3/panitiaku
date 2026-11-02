import { describe, expect, it } from 'vitest';
import { formatCurrency } from './format.js';

// ---------------------------------------------------------------------------
// Unit: formatter uang (PROJECT §15 "Tambahan wajib: unit formatter
// Intl.NumberFormat('id-ID)"). formatCurrency dibangun di atas
// Intl.NumberFormat('id-ID') tanpa float (BigInt) sehingga presisi nominal
// besar tetap utuh dan output konsisten dengan ledger backend.
// ---------------------------------------------------------------------------

describe('formatCurrency (Intl.NumberFormat id-ID)', () => {
  it('desimal string positif → Rp dengan titik ribuan, tanpa desimal ".00"', () => {
    expect(formatCurrency('1500000.00')).toBe('Rp1.500.000');
    expect(formatCurrency('100000')).toBe('Rp100.000');
    expect(formatCurrency('1234567')).toBe('Rp1.234.567');
  });

  it('nol → Rp0', () => {
    expect(formatCurrency('0')).toBe('Rp0');
    expect(formatCurrency('0.00')).toBe('Rp0');
    expect(formatCurrency(0)).toBe('Rp0');
  });

  it('desimal non-nol (2 digit) → koma desimal, tanpa pembulatan', () => {
    expect(formatCurrency('250000.50')).toBe('Rp250.000,50');
    expect(formatCurrency('100000.05')).toBe('Rp100.000,05');
  });

  it('negatif → tanda minus di depan Rp', () => {
    expect(formatCurrency('-250000.50')).toBe('-Rp250.000,50');
    expect(formatCurrency(-100000)).toBe('-Rp100.000');
    expect(formatCurrency('-0.00')).toBe('Rp0');
  });

  it('input number → diformat sama dengan setara string', () => {
    expect(formatCurrency(1500000)).toBe('Rp1.500.000');
    expect(formatCurrency(100000)).toBe('Rp100.000');
    expect(formatCurrency(-250000)).toBe('-Rp250.000');
  });

  it('input tidak valid / non-finite → Rp0 (tidak melempar)', () => {
    expect(formatCurrency('abc')).toBe('Rp0');
    expect(formatCurrency('')).toBe('Rp0');
    expect(formatCurrency(NaN)).toBe('Rp0');
    expect(formatCurrency(Infinity)).toBe('Rp0');
    expect(formatCurrency(-Infinity)).toBe('Rp0');
  });

  it('tidak melewati float: nominal besar tetap presisi', () => {
    const besar = '999999999999999999.00';
    const out = formatCurrency(besar);
    expect(out).toBe('Rp999.999.999.999.999.999');
    expect(out).not.toContain('e');
    expect(out).not.toContain(','); // tidak ada desimal (fraction .00 disembunyikan)
  });
});
