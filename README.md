# Panitiaku

Aplikasi web untuk membantu panitia acara kampus mengelola anggota, struktur organisasi, undangan, dan transaksi keuangan dalam satu tempat.

> Proyek ini masih dalam pengembangan. Beberapa fitur dan panduan operasional dapat berubah.

## Fitur

- Autentikasi pengguna dan pengelolaan acara.
- Struktur organisasi hierarkis dan pengelolaan anggota.
- Undangan anggota.
- Pencatatan transaksi serta bukti transaksi.
- Audit aktivitas penting.

## Teknologi

- **Frontend:** React, TypeScript, Vite, Tailwind CSS, React Router, TanStack Query, React Flow.
- **Backend:** Node.js, Express 5, TypeScript, Prisma.
- **Database:** PostgreSQL 16.
- **Testing:** Vitest, Supertest, React Testing Library.

## Struktur proyek

```text
.
├── backend/       # REST API, Prisma schema, migrations, dan backend tests
├── frontend/      # Aplikasi web dan frontend tests
├── docs/          # Panduan deployment dan security checklist
└── README.md
```

## Persiapan lokal

### Prasyarat

- Node.js 20 atau lebih baru.
- npm.
- Docker untuk menjalankan PostgreSQL lokal, atau PostgreSQL 16 yang sudah tersedia.

### 1. Jalankan database

Dari root repository:

```bash
cd backend
docker compose up -d
```

Konfigurasi Docker Compose ditujukan untuk pengembangan lokal. Jangan gunakan kredensial atau konfigurasi lokalnya untuk deployment.

### 2. Siapkan backend

Dari folder `backend`:

Salin `.env.example` menjadi `.env`:

```powershell
Copy-Item .env.example .env
```

Di macOS/Linux, gunakan `cp .env.example .env`.

```bash
npm install
npm run db:generate
npm run db:migrate
npm run dev
```

> Perintah `npm run db:migrate` membuat migrasi untuk lingkungan pengembangan. Untuk deployment, ikuti [`docs/DEPLOYMENT.md`](./docs/DEPLOYMENT.md).

Backend berjalan di `http://localhost:4000`. Health check tersedia di `/api/v1/health`.

### 3. Siapkan frontend

Buka terminal lain, lalu dari folder `frontend`:

Salin `.env.example` menjadi `.env`. Di PowerShell gunakan:

```powershell
Copy-Item .env.example .env
```

Di macOS/Linux, gunakan `cp .env.example .env`.

```bash
npm install
npm run dev
```

Buka alamat lokal yang ditampilkan Vite, biasanya `http://localhost:5173`.

## Pemeriksaan dan test

Jalankan perintah dari folder masing-masing:

| Folder | Perintah | Kegunaan |
|---|---|---|
| `backend` | `npm run typecheck` | Pemeriksaan TypeScript |
| `backend` | `npm run lint` | Pemeriksaan lint |
| `backend` | `npm test` | Test backend; memerlukan database test lokal |
| `backend` | `npm run test:coverage` | Test backend dengan laporan coverage |
| `frontend` | `npm run build` | Pemeriksaan TypeScript dan build produksi |
| `frontend` | `npm run lint` | Pemeriksaan lint |
| `frontend` | `npm test` | Test frontend |

Jangan arahkan test ke database yang berisi data penting. Backend test menggunakan database `event_committee_test` pada PostgreSQL lokal port `5433`.

## Konfigurasi dan keamanan

- Salin `.env.example` menjadi `.env` untuk konfigurasi lokal.
- Jangan commit `.env`, credential, token, private key, atau data pengguna. File `.env` sudah diabaikan oleh `.gitignore`.
- Nilai contoh hanya untuk pengembangan lokal. Buat secret unik dan gunakan secret manager untuk deployment.
- Jangan memasukkan data pribadi atau data keuangan nyata ke lingkungan demo/test.

## Dokumentasi

- [Panduan deployment, backup, dan restore](./docs/DEPLOYMENT.md)
- [Security checklist](./docs/SECURITY-CHECKLIST.md)
- [OpenAPI](./backend/docs/openapi.json)

## Kontribusi

Perubahan kode sebaiknya disertai test yang relevan. Sebelum membuka pull request, jalankan pemeriksaan yang sesuai untuk area yang diubah dan jangan sertakan file konfigurasi lokal atau secret.
