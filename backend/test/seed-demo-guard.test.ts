import { describe, expect, test } from 'vitest';
import {
  ALLOWED_DEMO_SEED_DATABASES,
  validateDemoSeedDatabase,
} from '../scripts/seed-demo.js';

describe('validateDemoSeedDatabase (demo seed DB allowlist)', () => {
  test('menerima nama database non-produksi dalam allowlist', () => {
    for (const name of ALLOWED_DEMO_SEED_DATABASES) {
      expect(() => validateDemoSeedDatabase(name)).not.toThrow();
    }
  });

  test('menolak database produksi atau nama produksi serupa', () => {
    for (const name of [
      'production',
      'prod',
      'event_committee_prod',
      'event_committee-production',
      'PRODUCTION',
    ]) {
      expect(() => validateDemoSeedDatabase(name)).toThrow();
    }
  });

  test('menolak nama database sembarang (bukan allowlist eksak)', () => {
    for (const name of [
      '',
      'event_committee_dev',
      'my-dev-db',
      'localhost_dev',
      'event_committee_test_backup',
      'event_committee_test ',
      ' event_committee',
    ]) {
      expect(() => validateDemoSeedDatabase(name)).toThrow();
    }
  });

  test('pesan error menyebutkan allowlist', () => {
    try {
      validateDemoSeedDatabase('database-sembarang');
    } catch (error) {
      expect((error as Error).message).toContain('event_committee');
      expect((error as Error).message).toContain('event_committee_test');
      return;
    }
    expect.fail('harus melempar error untuk database yang tidak diizinkan');
  });
});
