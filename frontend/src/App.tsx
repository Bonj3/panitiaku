/**
 * App tidak lagi merender halaman langsung.
 * Entry point adalah `src/main.tsx` → `src/app/providers.tsx` → router.
 * File ini dipertahankan sebagai re-export agar impor lama tidak rusak.
 */
export { Providers as default } from "./app/providers";
