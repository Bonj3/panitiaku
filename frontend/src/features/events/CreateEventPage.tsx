import { useState } from "react";
import { useForm } from "react-hook-form";
import { Link } from "react-router";
import { toFriendlyMessage } from "@/components/shared/ErrorState";
import { PageHeader } from "@/components/shared/PageHeader";
import { AppHeader } from "@/app/AppHeader";
import { ApiError } from "@/lib/api-client";
import { zodResolver } from "@hookform/resolvers/zod";
import { createEventSchema } from "./event.schema";
import type { CreateEventFormData } from "./event.schema";
import { useCreateEvent } from "./use-events";

const inputClass =
  "mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-500 focus:ring-1 focus:ring-slate-500 focus:outline-none";

/**
 * Form buat event (route "/events/new"). RHF + Zod; error 409 (slug dipakai)
 * dan error API lain ditampilkan sebagai alert. Setelah sukses, hook
 * `useCreateEvent` mengarahkan ke `/events/:id`.
 */
export function CreateEventPage() {
  const [apiError, setApiError] = useState<string | null>(null);
  const createEvent = useCreateEvent();

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<CreateEventFormData>({
    resolver: zodResolver(createEventSchema),
    defaultValues: { name: "", slug: "", description: "" },
  });

  const onSubmit = handleSubmit(async (values) => {
    setApiError(null);
    try {
      await createEvent.mutateAsync({
        name: values.name,
        slug: values.slug?.trim() ? values.slug.trim() : undefined,
        description: values.description?.trim()
          ? values.description.trim()
          : undefined,
      });
      // Redirect ditangani di dalam useCreateEvent.onSuccess.
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        // Bentrok slug: tandai field slug + tampilkan alert.
        setError("slug", { type: "server", message: "Slug sudah dipakai" });
        setApiError(
          "Slug sudah dipakai event lain. Silakan pilih slug yang berbeda.",
        );
      } else {
        setApiError(toFriendlyMessage(err));
      }
    }
  });

  return (
    <>
      <AppHeader />
      <main className="mx-auto max-w-2xl px-6 py-12">
        <PageHeader
          title="Buat event baru"
          description="Event baru otomatis menempatkan Anda sebagai Ketua Event."
        />

        {apiError ? (
          <div
            role="alert"
            className="mt-6 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
          >
            {apiError}
          </div>
        ) : null}

        <form
          onSubmit={onSubmit}
          noValidate
          className="mt-6 rounded-lg border border-slate-200 bg-white p-6 shadow-sm sm:p-8"
        >
          <div className="space-y-5">
            <div>
              <label
                htmlFor="name"
                className="block text-sm font-medium text-slate-700"
              >
                Nama event
              </label>
              <input
                id="name"
                type="text"
                placeholder="Contoh: Reuni Akbar 2026"
                {...register("name")}
                aria-invalid={Boolean(errors.name)}
                className={inputClass}
              />
              {errors.name ? (
                <p role="alert" className="mt-1 text-sm text-red-700">
                  {errors.name.message}
                </p>
              ) : null}
            </div>

            <div>
              <label
                htmlFor="slug"
                className="block text-sm font-medium text-slate-700"
              >
                Slug <span className="font-normal text-slate-500">(opsional)</span>
              </label>
              <input
                id="slug"
                type="text"
                placeholder="Contoh: reuni-akbar-2026"
                {...register("slug")}
                aria-invalid={Boolean(errors.slug)}
                className={inputClass}
              />
              <p className="mt-1 text-xs text-slate-500">
                Kosongkan untuk dibuat otomatis dari nama event.
              </p>
              {errors.slug ? (
                <p role="alert" className="mt-1 text-sm text-red-700">
                  {errors.slug.message}
                </p>
              ) : null}
            </div>

            <div>
              <label
                htmlFor="description"
                className="block text-sm font-medium text-slate-700"
              >
                Deskripsi{" "}
                <span className="font-normal text-slate-500">(opsional)</span>
              </label>
              <textarea
                id="description"
                rows={4}
                placeholder="Ceritakan singkat tentang event ini…"
                {...register("description")}
                aria-invalid={Boolean(errors.description)}
                className={inputClass}
              />
              {errors.description ? (
                <p role="alert" className="mt-1 text-sm text-red-700">
                  {errors.description.message}
                </p>
              ) : null}
            </div>
          </div>

          <div className="mt-8 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <Link
              to="/"
              className="rounded-md border border-slate-300 px-4 py-2 text-center text-sm font-medium text-slate-700 transition hover:bg-slate-100"
            >
              Batal
            </Link>
            <button
              type="submit"
              disabled={isSubmitting}
              className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSubmitting ? "Membuat…" : "Buat event"}
            </button>
          </div>
        </form>
      </main>
    </>
  );
}
