// Variabel lingkungan minimal harus di-set SEBELUM apapun mengimpor src/app.ts,
// karena src/config/env.ts memvalidasi dengan Zod dan memanggil process.exit(1)
// bila gagal (fail-fast). Vitest menjalankan setupFiles sebelum module tes.
process.env.DATABASE_URL =
  "postgresql://postgres:postgres@localhost:5433/event_committee_test?schema=public";
process.env.SESSION_SECRET = "test-secret-minimal-32-characters!!";
process.env.CORS_ORIGIN = "http://localhost:5173";
process.env.PORT = "4001";
process.env.NODE_ENV = "test";
