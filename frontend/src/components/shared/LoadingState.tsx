interface LoadingStateProps {
  label?: string;
}

export function LoadingState({ label = "Memuat…" }: LoadingStateProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center justify-center gap-3 rounded-lg border border-slate-200 bg-white px-6 py-12"
    >
      <span
        aria-hidden="true"
        className="h-5 w-5 animate-spin rounded-full border-2 border-slate-300 border-t-slate-700"
      />
      <p className="text-sm text-slate-600">{label}</p>
    </div>
  );
}
