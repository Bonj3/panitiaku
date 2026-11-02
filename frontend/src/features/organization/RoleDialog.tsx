import { useState } from "react";
import { Dialog } from "@/components/shared/Dialog";
import { toFriendlyMessage } from "@/components/shared/ErrorState";
import { ORG_ROLE_LABEL, type OrgRole, type UpdateMemberRole } from "./organization.types";

interface RoleDialogProps {
  open: boolean;
  memberName: string;
  currentRole: OrgRole;
  isPending: boolean;
  error: unknown;
  onClose: () => void;
  onSubmit: (role: UpdateMemberRole) => Promise<void>;
}

const ROLE_OPTIONS: Array<{ value: UpdateMemberRole; hint: string }> = [
  { value: "DIVISION_LEADER", hint: "Memimpin divisi, mengelola subtree-nya" },
  { value: "MEMBER", hint: "Anggota biasa, read-only" },
];

/**
 * Dialog eksplisit ubah peran anggota (hanya Ketua Event).
 * Pilihan: Ketua Divisi ↔ Anggota. Bukan diri sendiri & bukan root
 * (disembunyikan pemanggil via `canEditRole`).
 */
export function RoleDialog({
  open,
  memberName,
  currentRole,
  isPending,
  error,
  onClose,
  onSubmit,
}: RoleDialogProps) {
  const [selected, setSelected] = useState<UpdateMemberRole>(
    currentRole === "DIVISION_LEADER" ? "MEMBER" : "DIVISION_LEADER",
  );
  const [submitError, setSubmitError] = useState<unknown>(null);

  // Sinkronkan pilihan awal setiap dialog dibuka untuk anggota berbeda.
  const [lastMember, setLastMember] = useState(memberName);
  if (memberName !== lastMember) {
    setLastMember(memberName);
    setSelected(currentRole === "DIVISION_LEADER" ? "MEMBER" : "DIVISION_LEADER");
    setSubmitError(null);
  }

  const displayError = submitError ?? error;

  return (
    <Dialog
      title={`Ubah peran ${memberName}`}
      description={`Peran saat ini: ${ORG_ROLE_LABEL[currentRole]}. Pilih peran baru, lalu simpan.`}
      open={open}
      onClose={onClose}
    >
      {displayError ? (
        <div
          role="alert"
          className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
        >
          {toFriendlyMessage(displayError)}
        </div>
      ) : null}
      <fieldset>
        <legend className="sr-only">Peran baru</legend>
        <div className="space-y-2">
          {ROLE_OPTIONS.map((option) => (
            <label
              key={option.value}
              className={`flex cursor-pointer items-start gap-3 rounded-md border px-3 py-2.5 text-sm transition ${
                selected === option.value
                  ? "border-slate-900 bg-slate-50"
                  : "border-slate-200 hover:bg-slate-50"
              }`}
            >
              <input
                type="radio"
                name="role"
                value={option.value}
                checked={selected === option.value}
                onChange={() => setSelected(option.value)}
                disabled={isPending}
                className="mt-1 accent-slate-900"
              />
              <span>
                <span className="font-medium text-slate-900">
                  {ORG_ROLE_LABEL[option.value]}
                  {option.value === currentRole ? " (saat ini)" : ""}
                </span>
                <span className="block text-xs text-slate-500">
                  {option.hint}
                </span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button
          type="button"
          onClick={onClose}
          disabled={isPending}
          className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-60"
        >
          Batal
        </button>
        <button
          type="button"
          disabled={isPending}
          onClick={async () => {
            setSubmitError(null);
            try {
              await onSubmit(selected);
            } catch (err) {
              setSubmitError(err);
            }
          }}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-60"
        >
          {isPending ? "Menyimpan…" : "Simpan peran"}
        </button>
      </div>
    </Dialog>
  );
}
