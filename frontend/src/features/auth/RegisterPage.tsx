import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { Link, useNavigate } from "react-router";
import { toFriendlyMessage } from "@/components/shared/ErrorState";
import { zodResolver } from "@hookform/resolvers/zod";
import { authService } from "./auth.service";
import { registerSchema } from "./auth.schema";
import type { RegisterFormData } from "./auth.schema";
import { useAuth } from "./use-auth";

/**
 * Halaman pendaftaran. Publik; pengguna yang sudah login dialihkan ke "/".
 * Setelah register berhasil, pengguna langsung diarahkan masuk: akun dibuat
 * tanpa sesi (backend tidak men-set cookie saat register), sehingga form
 * login ditampilkan kembali dengan email yang sudah terisi.
 */
export function RegisterPage() {
  const { isAuthenticated, isLoading, login } = useAuth();
  const navigate = useNavigate();
  const [apiError, setApiError] = useState<string | null>(null);

  useEffect(() => {
    if (!isLoading && isAuthenticated) {
      void navigate("/", { replace: true });
    }
  }, [isAuthenticated, isLoading, navigate]);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<RegisterFormData>({
    resolver: zodResolver(registerSchema),
    defaultValues: { name: "", email: "", password: "", confirmPassword: "" },
  });

  const onSubmit = handleSubmit(async (values) => {
    setApiError(null);
    try {
      await authService.register({
        name: values.name,
        email: values.email,
        password: values.password,
      });
      // Register tidak membuat sesi; langsung login lalu ke beranda.
      await login({ email: values.email, password: values.password });
      void navigate("/", { replace: true });
    } catch (err) {
      setApiError(toFriendlyMessage(err));
    }
  });

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-12">
      <section className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
        <p className="text-xs font-semibold tracking-widest text-slate-500 uppercase">
          Web Panitia
        </p>
        <h1 className="mt-2 text-2xl font-bold text-slate-900">
          Buat akun baru
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Daftar untuk mulai mengelola kepanitiaan Anda.
        </p>

        {apiError ? (
          <div
            role="alert"
            className="mt-6 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
          >
            {apiError}
          </div>
        ) : null}

        <form onSubmit={onSubmit} noValidate className="mt-6 space-y-5">
          <div>
            <label
              htmlFor="name"
              className="block text-sm font-medium text-slate-700"
            >
              Nama lengkap
            </label>
            <input
              id="name"
              type="text"
              autoComplete="name"
              placeholder="Nama Anda"
              {...register("name")}
              aria-invalid={Boolean(errors.name)}
              className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-500 focus:ring-1 focus:ring-slate-500 focus:outline-none"
            />
            {errors.name ? (
              <p role="alert" className="mt-1 text-sm text-red-700">
                {errors.name.message}
              </p>
            ) : null}
          </div>

          <div>
            <label
              htmlFor="email"
              className="block text-sm font-medium text-slate-700"
            >
              Email
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              placeholder="nama@contoh.id"
              {...register("email")}
              aria-invalid={Boolean(errors.email)}
              className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-500 focus:ring-1 focus:ring-slate-500 focus:outline-none"
            />
            {errors.email ? (
              <p role="alert" className="mt-1 text-sm text-red-700">
                {errors.email.message}
              </p>
            ) : null}
          </div>

          <div>
            <label
              htmlFor="password"
              className="block text-sm font-medium text-slate-700"
            >
              Kata sandi
            </label>
            <input
              id="password"
              type="password"
              autoComplete="new-password"
              placeholder="Minimal 8 karakter"
              {...register("password")}
              aria-invalid={Boolean(errors.password)}
              className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-500 focus:ring-1 focus:ring-slate-500 focus:outline-none"
            />
            {errors.password ? (
              <p role="alert" className="mt-1 text-sm text-red-700">
                {errors.password.message}
              </p>
            ) : null}
          </div>

          <div>
            <label
              htmlFor="confirmPassword"
              className="block text-sm font-medium text-slate-700"
            >
              Konfirmasi kata sandi
            </label>
            <input
              id="confirmPassword"
              type="password"
              autoComplete="new-password"
              placeholder="Ulangi kata sandi"
              {...register("confirmPassword")}
              aria-invalid={Boolean(errors.confirmPassword)}
              className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-500 focus:ring-1 focus:ring-slate-500 focus:outline-none"
            />
            {errors.confirmPassword ? (
              <p role="alert" className="mt-1 text-sm text-red-700">
                {errors.confirmPassword.message}
              </p>
            ) : null}
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full rounded-md bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSubmitting ? "Memproses…" : "Daftar"}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-slate-600">
          Sudah punya akun?{" "}
          <Link
            to="/auth/login"
            className="font-medium text-slate-900 underline underline-offset-4 hover:text-slate-700"
          >
            Masuk
          </Link>
        </p>
      </section>
    </main>
  );
}

