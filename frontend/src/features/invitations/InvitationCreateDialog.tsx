import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { Dialog } from "@/components/shared/Dialog";
import { toFriendlyMessage } from "@/components/shared/ErrorState";
import { ORG_ROLE_LABEL } from "@/features/organization/organization.types";
import { getClientSubtreeIds } from "@/features/organization/organization.permissions";
import type { OrganizationTree } from "@/features/organization/organization.types";
import { useOrganization } from "@/features/organization/use-organization";
import { ApiError } from "@/lib/api-client";
import { zodResolver } from "@hookform/resolvers/zod";
import { allowedInviteRoles } from "./invitation.permissions";
import { createInvitationSchema } from "./invitation.schema";
import type { CreateInvitationFormData } from "./invitation.schema";
import { useCreateInvitation } from "./use-invitations";
import type { CreateInvitationResult } from "./invitation.types";

interface InvitationCreateDialogProps {
  eventId: string;
  actorRole: string;
  actorMemberId: string;
  open: boolean;
  onClose: () => void;
}

const inputClass =
  "mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-500 focus:ring-1 focus:ring-slate-500 focus:outline-none disabled:opacity-60";

/**
 * Dialog "Undang anggota": form email + peran + atasan.
 * - Peran dibatasi per aktor (chair: LEADER/MEMBER, leader: MEMBER saja).
 * - Atasan: flatten tree urut depth ("Nama — Role"), hanya ACTIVE;
 *   untuk leader dibatasi ke subtree-nya (UX; backend tetap penegak).
 * - Sukses: panel hasil berisi link undangan + "Salin link" +
 *   peringatan token sekali tampil. Token tidak disimpan setelah tutup.
 */
export function InvitationCreateDialog({
  eventId,
  actorRole,
  actorMemberId,
  open,
  onClose,
}: InvitationCreateDialogProps) {
  const createMutation = useCreateInvitation(eventId);
  const orgQuery = useOrganization(eventId);

  const [result, setResult] = useState<CreateInvitationResult | null>(null);
  const [copied, setCopied] = useState(false);
  const [submitError, setSubmitError] = useState<unknown>(null);

  const roleOptions = allowedInviteRoles(actorRole);

  const {
    register,
    handleSubmit,
    reset,
    setError,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<CreateInvitationFormData>({
    resolver: zodResolver(createInvitationSchema),
    defaultValues: {
      email: "",
      role: roleOptions[0] ?? "MEMBER",
      parentId: "",
    },
  });

  // Sinkronkan default peran saat aktor berubah (leader hanya MEMBER).
  const [lastActor, setLastActor] = useState(actorRole);
  if (actorRole !== lastActor) {
    setLastActor(actorRole);
    const first = allowedInviteRoles(actorRole)[0] ?? "MEMBER";
    reset({ email: "", role: first, parentId: "" });
    setResult(null);
    setSubmitError(null);
    setCopied(false);
  }

  const tree: OrganizationTree | null = orgQuery.data ?? null;

  const parentCandidates = useMemo(() => {
    if (!tree) return [];
    const leaderSubtree =
      actorRole === "DIVISION_LEADER"
        ? getClientSubtreeIds(tree, actorMemberId)
        : null;
    return tree.nodes
      .filter((node) => {
        if (node.status !== "ACTIVE") return false;
        if (leaderSubtree && !leaderSubtree.has(node.id)) return false;
        return true;
      })
      .sort(
        (a, b) => a.depth - b.depth || a.name.localeCompare(b.name, "id"),
      );
  }, [tree, actorRole, actorMemberId]);

  const selectedParentId = watch("parentId");

  const handleClose = () => {
    // Token tidak disimpan di mana pun setelah dialog ditutup.
    setResult(null);
    setSubmitError(null);
    setCopied(false);
    reset({ email: "", role: roleOptions[0] ?? "MEMBER", parentId: "" });
    createMutation.reset();
    onClose();
  };

  const onSubmit = handleSubmit(async (values) => {
    setSubmitError(null);
    setCopied(false);
    createMutation.reset();
    try {
      const created = await createMutation.mutateAsync({
        email: values.email,
        role: values.role,
        parentId: values.parentId,
      });
      setResult(created);
      setSubmitError(null);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        // Bentrok PENDING/anggota aktif: tandai field email + alert.
        setError("email", { type: "server", message: err.message });
      }
      setSubmitError(err);
      setResult(null);
    }
  });

  const inviteLink = result
    ? `${window.location.origin}/invitations/${result.token}`
    : null;

  const handleCopy = async () => {
    if (!inviteLink) return;
    try {
      await navigator.clipboard.writeText(inviteLink);
      setCopied(true);
    } catch {
      // Clipboard mungkin tidak tersedia (izin/konteks non-secure):
      // tampilkan link agar bisa disalin manual.
      setCopied(false);
    }
  };

  return (
    <Dialog
      title={result && !createMutation.error ? "Undangan berhasil dibuat" : "Undang anggota"}
      description={
        result && !createMutation.error
          ? "Bagikan link berikut kepada calon anggota."
          : "Isi email, peran, dan atasan langsung calon anggota."
      }
      open={open}
      onClose={handleClose}
    >
      {result && !createMutation.error && inviteLink ? (
        <div className="space-y-4">
          <div
            role="alert"
            className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
          >
            <p className="font-semibold">Token hanya ditampilkan sekali.</p>
            <p className="mt-1">
              Salin link sekarang — setelah dialog ditutup, link tidak dapat
              ditampilkan ulang.
            </p>
          </div>

          <div>
            <p className="mb-1 text-xs font-semibold tracking-widest text-slate-500 uppercase">
              Link undangan
            </p>
            <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm break-all text-slate-900 select-all">
              {inviteLink}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Untuk {result.invitation.email} · berlaku hingga{" "}
              {formatExpiry(result.invitation.expiresAt)}
            </p>
          </div>

          {copied ? (
            <p role="status" className="text-sm font-medium text-emerald-700">
              Link berhasil disalin.
            </p>
          ) : null}

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={handleClose}
              className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
            >
              Tutup
            </button>
            <button
              type="button"
              onClick={() => void handleCopy()}
              className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700"
            >
              Salin link
            </button>
          </div>
        </div>
      ) : (
        <form onSubmit={onSubmit} noValidate className="space-y-5">
          {submitError ? (
            <div
              role="alert"
              className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
            >
              {toFriendlyInvitationError(submitError)}
            </div>
          ) : null}

          {orgQuery.error ? (
            <p role="alert" className="text-sm text-red-700">
              Gagal memuat daftar atasan:{" "}
              {toFriendlyMessage(orgQuery.error)} Anda tetap dapat mencoba
              mengisi form, tetapi pilihan atasan mungkin kosong.
            </p>
          ) : null}

          <div>
            <label
              htmlFor="invitation-email"
              className="block text-sm font-medium text-slate-700"
            >
              Email calon anggota
            </label>
            <input
              id="invitation-email"
              type="email"
              autoComplete="email"
              placeholder="nama@contoh.id"
              {...register("email")}
              aria-invalid={Boolean(errors.email)}
              disabled={isSubmitting}
              className={inputClass}
            />
            {errors.email ? (
              <p role="alert" className="mt-1 text-sm text-red-700">
                {errors.email.message}
              </p>
            ) : null}
          </div>

          <div>
            <label
              htmlFor="invitation-role"
              className="block text-sm font-medium text-slate-700"
            >
              Peran
            </label>
            <select
              id="invitation-role"
              {...register("role")}
              aria-invalid={Boolean(errors.role)}
              disabled={isSubmitting || roleOptions.length === 0}
              className={inputClass}
            >
              {roleOptions.map((role) => (
                <option key={role} value={role}>
                  {ORG_ROLE_LABEL[role]}
                </option>
              ))}
            </select>
            {actorRole === "DIVISION_LEADER" ? (
              <p className="mt-1 text-xs text-slate-500">
                Ketua Divisi hanya dapat mengundang Anggota.
              </p>
            ) : null}
            {errors.role ? (
              <p role="alert" className="mt-1 text-sm text-red-700">
                {errors.role.message}
              </p>
            ) : null}
          </div>

          <div>
            <label
              htmlFor="invitation-parent"
              className="block text-sm font-medium text-slate-700"
            >
              Atasan langsung
            </label>
            {orgQuery.isLoading ? (
              <p aria-live="polite" className="mt-1 text-sm text-slate-500">
                Memuat daftar atasan…
              </p>
            ) : (
              <select
                id="invitation-parent"
                {...register("parentId")}
                aria-invalid={Boolean(errors.parentId)}
                disabled={isSubmitting || parentCandidates.length === 0}
                className={inputClass}
              >
                <option value="">— Pilih atasan —</option>
                {parentCandidates.map((node) => (
                  <option key={node.id} value={node.id}>
                    {"— ".repeat(Math.min(node.depth, 4))}
                    {node.name} — {ORG_ROLE_LABEL[node.role]}
                  </option>
                ))}
              </select>
            )}
            {actorRole === "DIVISION_LEADER" ? (
              <p className="mt-1 text-xs text-slate-500">
                Pilihan dibatasi pada anggota dalam divisi Anda.
              </p>
            ) : null}
            {selectedParentId === actorMemberId ? (
              <p className="mt-1 text-xs text-slate-500">
                Atasan yang dipilih adalah diri Anda sendiri.
              </p>
            ) : null}
            {errors.parentId ? (
              <p role="alert" className="mt-1 text-sm text-red-700">
                {errors.parentId.message}
              </p>
            ) : null}
            {!orgQuery.isLoading && parentCandidates.length === 0 ? (
              <p className="mt-1 text-xs text-slate-500">
                Tidak ada calon atasan yang valid (struktur kosong atau semua
                nonaktif).
              </p>
            ) : null}
          </div>

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={handleClose}
              disabled={isSubmitting}
              className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-60"
            >
              Batal
            </button>
            <button
              type="submit"
              disabled={isSubmitting || parentCandidates.length === 0}
              className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-60"
            >
              {isSubmitting ? "Membuat undangan…" : "Buat undangan"}
            </button>
          </div>
        </form>
      )}
    </Dialog>
  );
}

function formatExpiry(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("id-ID", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

/**
 * Pesan backend (ApiError { code, message }) diterjemahkan ke bahasa
 * Indonesia yang ramah untuk konteks buat undangan.
 */
export function toFriendlyInvitationError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 409) {
      if (error.code === "EVENT_CLOSED" || /ditutup/i.test(error.message)) {
        return "Event sudah ditutup sehingga tidak dapat membuat undangan baru.";
      }
      return error.message;
    }
    if (error.status === 403) return error.message;
    if (error.status === 422) return error.message;
    return error.message;
  }
  return toFriendlyMessage(error);
}
