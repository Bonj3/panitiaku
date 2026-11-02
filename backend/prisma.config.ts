// backend/prisma.config.ts
// Konfigurasi Prisma ORM v7.
// Dokumen resmi: https://www.prisma.io/docs/orm/v7/reference/prisma-config-reference
//
// Catatan:
// - `datasource.url` diatur di sini (bukan di prisma/schema.prisma).
// - Menggunakan `process.env` (bukan `env()`) sengaja, agar `prisma generate` dan
//   `prisma validate` tetap berjalan meski DATABASE_URL belum tersedia
//   (DB belum di-nyalakan). `env()` akan melempar error saat variabel hilang.

import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: process.env.DATABASE_URL ?? "",
  },
});
