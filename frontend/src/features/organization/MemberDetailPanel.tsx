import { useState } from "react";
import { Dialog } from "@/components/shared/Dialog";
import { toFriendlyMessage } from "@/components/shared/ErrorState";
import {
  canEditRole,
  canEditStatus,
  canMoveMember,
} from "./organization.permissions";
import { ORG_ROLE_LABEL, ORG_STATUS_LABEL } from "./organization.types";
import type {
  MemberDetailResponse,
  OrganizationTree,
  UpdateMemberRole,
} from "./organization.types";
import { useUpdateMemberRole, useUpdateMemberStatus } from "./use-organization";
import { MoveMemberDialog } from "./MoveMemberDialog";
import { RoleDialog } from "./RoleDialog";

interface MemberDetailPanelProps {
  eventId: string;
  detail: MemberDetailResponse;
  tree: OrganizationTree;
  /** Role aktor yang login (EVENT_CHAIR | DIVISION_LEADER | MEMBER). */
  actorRole: string;
  /** Id event-member milik aktor (bukan user id). */
  actorMemberId: string;
  /** Id root tree (Ketua Event). */
  rootId: string;
  /** Subtree aktor (untuk DIVISION_LEADER). Null untuk role lain. */
  leaderSubtreeIds: Set<string> | null;
  /** Klik atasan/anak untuk berpindah pilihan. */
  onNavigate: (memberId: string) => void;
}

/**
 * Panel detail anggota terpilih: nama, role, status, jabatan,
 * atasan, anak langsung. Email tidak ditampilkan di panel anggota
 * (finding Phase 7: email tidak diekspos ke semua anggota aktif);
 * email hanya tersedia pada profil sendiri. Tombol aksi hanya tampil
 * sesuai hak (UX saja; backend tetap penegak otorisasi).
 */
export function MemberDetailPanel({
  eventId,
  detail,
  tree,
  actorRole,
  actorMemberId,
  rootId,
  leaderSubtreeIds,
  onNavigate,
}: MemberDetailPanelProps) {
  const { member, parent, children } = detail;
  const isSelf = member.id === actorMemberId;
  const isRoot = member.id === rootId;

  const showRoleAction = canEditRole(actorRole, actorMemberId, member);
  const showStatusAction = canEditStatus(
    actorRole,
    actorMemberId,
    member,
    rootId,
    leaderSubtreeIds,
  );
  const showMoveAction = canMoveMember(
    actorRole,
    actorMemberId,
    member,
    rootId,
    leaderSubtreeIds,
  );

  const statusMutation = useUpdateMemberStatus(eventId);
  const roleMutation = useUpdateMemberRole(eventId);

  const [roleOpen, setRoleOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [confirmStatus, setConfirmStatus] = useState<
    "ACTIVE" | "INACTIVE" | null
  >(null);

  const nextStatus = member.status === "ACTIVE" ? "INACTIVE" : "ACTIVE";

  return (
    <div
      aria-label={`Detail anggota ${member.name}`}
      className="flex h-full flex-col rounded-lg border border-slate-200 bg-white p-5 shadow-sm"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-base font-semibold text-slate-900">
            {member.name}
          </h3>
        </div>
        {isSelf ? (
          <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-600">
            Anda
          </span>
        ) : null}
        {isRoot ? (
          <span className="shrink-0 rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-medium text-amber-800">
            Root
          </span>
        ) : null}
      </div>

      <dl className="mt-4 space-y-2.5 text-sm">
        <div className="flex justify-between gap-3">
          <dt className="text-slate-500">Peran</dt>
          <dd className="font-medium text-slate-900">
            {ORG_ROLE_LABEL[member.role]}
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-slate-500">Status</dt>
          <dd
            className={`font-medium ${member.status === "ACTIVE" ? "text-emerald-700" : "text-slate-400"}`}
          >
            {ORG_STATUS_LABEL[member.status]}
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-slate-500">Jabatan</dt>
          <dd className="text-right font-medium text-slate-900">
            {member.title ?? "—"}
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-slate-500">Atasan langsung</dt>
          <dd className="text-right font-medium text-slate-900">
            {parent ? (
              <button
                type="button"
                onClick={() => onNavigate(parent.id)}
                className="underline underline-offset-4 hover:text-slate-700"
                aria-label={`Lihat atasan ${parent.name}`}
              >
                {parent.name}
              </button>
            ) : (
              "— (root)"
            )}
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-slate-500">Bawahan langsung</dt>
          <dd className="font-medium text-slate-900">{children.length}</dd>
        </div>
      </dl>

      {children.length > 0 ? (
        <div className="mt-3 border-t border-slate-100 pt-3">
          <p className="text-xs font-semibold tracking-widest text-slate-500 uppercase">
            Bawahan langsung
          </p>
          <ul className="mt-2 flex flex-wrap gap-2">
            {children.map((child) => (
              <li key={child.id}>
                <button
                  type="button"
                  onClick={() => onNavigate(child.id)}
                  className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
                  aria-label={`Lihat anggota ${child.name}`}
                >
                  {child.name}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {showRoleAction || showStatusAction || showMoveAction ? (
        <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-100 pt-4">
          {showRoleAction ? (
            <button
              type="button"
              onClick={() => {
                roleMutation.reset();
                setRoleOpen(true);
              }}
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-100"
              aria-label={`Ubah peran ${member.name}`}
            >
              Ubah peran
            </button>
          ) : null}
          {showStatusAction ? (
            <button
              type="button"
              onClick={() => {
                statusMutation.reset();
                setConfirmStatus(nextStatus);
              }}
              className={`rounded-md border px-3 py-1.5 text-xs font-medium transition ${
                nextStatus === "INACTIVE"
                  ? "border-red-300 text-red-700 hover:bg-red-50"
                  : "border-emerald-300 text-emerald-700 hover:bg-emerald-50"
              }`}
              aria-label={
                nextStatus === "INACTIVE"
                  ? `Nonaktifkan ${member.name}`
                  : `Aktifkan ${member.name}`
              }
            >
              {nextStatus === "INACTIVE" ? "Nonaktifkan" : "Aktifkan"}
            </button>
          ) : null}
          {showMoveAction ? (
            <button
              type="button"
              onClick={() => setMoveOpen(true)}
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-100"
              aria-label={`Pindahkan ${member.name}`}
            >
              Pindahkan
            </button>
          ) : null}
        </div>
      ) : null}

      <RoleDialog
        open={roleOpen}
        memberName={member.name}
        currentRole={member.role}
        isPending={roleMutation.isPending}
        error={roleMutation.error}
        onClose={() => setRoleOpen(false)}
        onSubmit={async (role: UpdateMemberRole) => {
          await roleMutation.mutateAsync({ memberId: member.id, role });
          setRoleOpen(false);
        }}
      />

      <Dialog
        title={
          confirmStatus === "INACTIVE"
            ? `Nonaktifkan ${member.name}?`
            : `Aktifkan ${member.name}?`
        }
        description={
          confirmStatus === "INACTIVE"
            ? "Anggota nonaktif tampil redup di bagan dan tidak dihitung sebagai atasan aktif."
            : "Anggota kembali berstatus aktif dalam struktur."
        }
        open={confirmStatus !== null}
        onClose={() => setConfirmStatus(null)}
      >
        {statusMutation.error ? (
          <div
            role="alert"
            className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
          >
            {toFriendlyMessage(statusMutation.error)}
          </div>
        ) : null}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={() => setConfirmStatus(null)}
            disabled={statusMutation.isPending}
            className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-60"
          >
            Batal
          </button>
          <button
            type="button"
            disabled={statusMutation.isPending}
            onClick={async () => {
              if (!confirmStatus) return;
              try {
                await statusMutation.mutateAsync({
                  memberId: member.id,
                  status: confirmStatus,
                });
                setConfirmStatus(null);
              } catch {
                // Error ditampilkan inline di dalam dialog.
              }
            }}
            className={`rounded-md px-4 py-2 text-sm font-semibold text-white disabled:opacity-60 ${
              confirmStatus === "INACTIVE"
                ? "bg-red-700 hover:bg-red-600"
                : "bg-emerald-700 hover:bg-emerald-600"
            }`}
          >
            {statusMutation.isPending
              ? "Menyimpan…"
              : confirmStatus === "INACTIVE"
                ? "Ya, nonaktifkan"
                : "Ya, aktifkan"}
          </button>
        </div>
      </Dialog>

      <MoveMemberDialog
        eventId={eventId}
        open={moveOpen}
        targetId={member.id}
        targetName={member.name}
        currentParentId={member.parentId}
        tree={tree}
        onClose={() => setMoveOpen(false)}
      />
    </div>
  );
}
