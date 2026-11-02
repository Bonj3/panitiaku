import { useMemo, useState } from "react";
import { Dialog } from "@/components/shared/Dialog";
import { toFriendlyMessage } from "@/components/shared/ErrorState";
import { getDescendantIds } from "./organization.permissions";
import { ORG_ROLE_LABEL, type OrganizationTree } from "./organization.types";
import { useMoveMember } from "./use-organization";

interface MoveMemberDialogProps {
  eventId: string;
  open: boolean;
  targetId: string;
  targetName: string;
  currentParentId: string | null;
  tree: OrganizationTree;
  onClose: () => void;
}

/**
 * Dialog eksplisit "Pindahkan anggota": pilih induk baru dari daftar node
 * (flatten tree, urut depth). Daftar mengecualikan diri sendiri, seluruh
 * keturunannya (cegah cycle di sisi UX), dan node INACTIVE —
 * backend tetap memvalidasi ulang (422/403).
 */
export function MoveMemberDialog({
  eventId,
  open,
  targetId,
  targetName,
  currentParentId,
  tree,
  onClose,
}: MoveMemberDialogProps) {
  const moveMutation = useMoveMember(eventId);
  const [selectedParent, setSelectedParent] = useState<string>("");
  const [submitError, setSubmitError] = useState<unknown>(null);

  // Reset pilihan setiap dialog dibuka untuk target berbeda.
  const [lastTarget, setLastTarget] = useState(targetId);
  if (targetId !== lastTarget) {
    setLastTarget(targetId);
    setSelectedParent("");
    setSubmitError(null);
  }

  const candidates = useMemo(() => {
    const descendants = getDescendantIds(tree.nodes, targetId);
    return tree.nodes
      .filter(
        (node) =>
          node.id !== targetId &&
          !descendants.has(node.id) &&
          node.status === "ACTIVE",
      )
      .sort(
        (a, b) => a.depth - b.depth || a.name.localeCompare(b.name, "id"),
      );
  }, [tree.nodes, targetId]);

  const parentName = (id: string | null): string => {
    if (!id) return "—";
    return tree.nodes.find((n) => n.id === id)?.name ?? "—";
  };

  const displayError = submitError ?? moveMutation.error;
  const isNoopSelection =
    selectedParent !== "" && selectedParent === currentParentId;

  return (
    <Dialog
      title={`Pindahkan ${targetName}`}
      description={`Atasan saat ini: ${parentName(currentParentId)}. Pilih atasan baru dari daftar.`}
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

      {candidates.length === 0 ? (
        <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-600">
          Tidak ada calon atasan yang valid (semua node lain adalah keturunan
          anggota ini atau berstatus nonaktif).
        </p>
      ) : (
        <div>
          <label
            htmlFor="move-new-parent"
            className="mb-1 block text-xs font-semibold tracking-widest text-slate-500 uppercase"
          >
            Atasan baru
          </label>
          <select
            id="move-new-parent"
            value={selectedParent}
            onChange={(event) => {
              setSelectedParent(event.target.value);
              setSubmitError(null);
              moveMutation.reset();
            }}
            disabled={moveMutation.isPending}
            className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 disabled:opacity-60"
          >
            <option value="">— Pilih atasan baru —</option>
            {candidates.map((node) => (
              <option key={node.id} value={node.id}>
                {"— ".repeat(Math.min(node.depth, 4))}
                {node.name} · {ORG_ROLE_LABEL[node.role]}
                {node.id === currentParentId ? " (saat ini)" : ""}
              </option>
            ))}
          </select>
          {isNoopSelection ? (
            <p className="mt-2 text-xs text-slate-500">
              Atasan yang dipilih sama dengan atasan saat ini — penyimpanan
              tidak mengubah apa pun.
            </p>
          ) : null}
        </div>
      )}

      <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button
          type="button"
          onClick={onClose}
          disabled={moveMutation.isPending}
          className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-60"
        >
          Batal
        </button>
        <button
          type="button"
          disabled={
            moveMutation.isPending ||
            selectedParent === "" ||
            candidates.length === 0
          }
          onClick={async () => {
            setSubmitError(null);
            try {
              await moveMutation.mutateAsync({
                memberId: targetId,
                newParentId: selectedParent,
              });
              onClose();
            } catch (err) {
              setSubmitError(err);
            }
          }}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-60"
        >
          {moveMutation.isPending ? "Memindahkan…" : "Pindahkan"}
        </button>
      </div>
    </Dialog>
  );
}
