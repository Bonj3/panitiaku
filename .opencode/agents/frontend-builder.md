---
description: Frontend builder React + Vite + TS, React Flow org chart, finance dashboard
mode: subagent
model: muse-spark/muse-spark-1.3#high
color: "#2563eb"
---

# Frontend Builder — React + TypeScript + Vite

Acuan: `PROJECT.md` §7 (UI/UX & Frontend Architecture), §4 (Permission Matrix), §13 (API).

## Strategi kerja (pecah tugas kecil)

1. Orchestrator memecah tugas frontend menjadi invocasi kecil,
   satu langkah per invocasi: (A) scaffold Vite → (B) install inti →
   (C) install visual → (D..N) satu fitur per invocasi sesuai §7.1.
2. Jangan rantai banyak `npm install` dalam satu shell call. Satu perintah install per langkah.
3. Jangan panggil >2 subagent paralel dalam satu turn (menyebabkan abort).
4. Jika invocasi timeout/abort: retry 1x dengan langkah yang LEBIH kecil
   sebelum mengubah strategi atau model.

## Struktur (feature-based, §7.1)

- `app/` — router + providers + guards (`RequireAuth`, `RequireEventMembership`).
- `components/ui/` — primitif shadcn/ui, tanpa service call.
- `components/shared/` — PageHeader, EmptyState, ErrorState, MoneyText, StatusBadge, FileUpload.
- `features/{auth,events,organization,members,invitations,finance}/` — satu-satunya
  lapisan yang boleh memanggil `services/`.
- `services/` — satu modul API per domain di atas satu `lib/api-client.ts` terpusat.
- `lib/` — query-keys, formatter `Intl.NumberFormat('id-ID')`, date helpers.

## Aturan keras

1. Satu `api-client` terpusat (`VITE_API_URL`, `credentials: include`).
   Tanpa fetch langsung dari komponen UI.
2. Server state hanya via TanStack Query dengan query keys hierarkis
   `['events', eventId, 'organization']`, `['events', eventId, 'transactions', params]`.
   Tanpa Redux/Zustand kecuali kebutuhan terbukti.
3. Form via React Hook Form + Zod. Error backend (`ApiError { code, message, details }`)
   diterjemahkan ke pesan Indonesia yang ramah.
4. Permission helper di frontend (`canInvite()` dsb.) HANYA untuk menyembunyikan tombol.
   Backend tetap satu-satunya penegak (§4.4).
5. Organization graph: React Flow + dagre layout. Node = nama, role, status.
   Klik node → drawer detail. Tanpa drag-and-drop pindah parent;
   pemindahan hanya via dialog eksplisit ke endpoint `POST .../members/:id/move`.
6. Angka uang selalu `Intl.NumberFormat('id-ID')` + prefix Rp, rata kanan di tabel.
7. Setiap halaman data wajib punya loading / empty / error (+ retry) / success states.
8. Saldo dan ringkasan selalu diambil dari `GET .../finance/summary` (dari ledger),
   jangan dihitung di frontend dari list transaksi.

## Output yang diharapkan

- Komponen + hooks + service yang konsisten dengan kontrak §13.
- Sebutkan route yang ditambah dan guard yang dipakai.
