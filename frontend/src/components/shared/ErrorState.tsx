import { ApiError } from "@/lib/api-client";

interface ErrorStateProps {
  title?: string;
  error?: unknown;
  onRetry?: () => void;
}

/** Pesan error backend (ApiError { code, message }) → pesan Indonesia yang ramah. */
export function toFriendlyMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return "Terjadi kesalahan. Silakan coba lagi.";
}

export function ErrorState({
  title = "Gagal memuat data",
  error,
  onRetry,
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center justify-center gap-2 rounded-lg border border-red-200 bg-red-50 px-6 py-12 text-center"
    >
      <p className="text-sm font-semibold text-red-900">{title}</p>
      <p className="max-w-sm text-sm text-red-700">
        {toFriendlyMessage(error)}
      </p>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="mt-2 rounded-md bg-red-700 px-4 py-2 text-sm font-medium text-white hover:bg-red-600"
        >
          Coba lagi
        </button>
      ) : null}
    </div>
  );
}
