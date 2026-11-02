import { useState } from "react";
import { InvitationCreateDialog } from "./InvitationCreateDialog";
import { canViewInvitations } from "./invitation.permissions";
import { InvitationList } from "./InvitationList";

interface InvitationSectionProps {
  eventId: string;
  /** Role aktor yang login (dari GET /events/:eventId membership). */
  actorRole: string;
  /** Id event-member milik aktor (= membership.id). */
  actorMemberId: string;
}

/**
 * Section undangan di EventDetailPage: tombol "Undang anggota" + daftar.
 * Hanya dirender untuk EVENT_CHAIR / DIVISION_LEADER (member read-only
 * tidak melihat section ini; backend tetap satu-satunya penegak).
 */
export function InvitationSection({
  eventId,
  actorRole,
  actorMemberId,
}: InvitationSectionProps) {
  const [dialogOpen, setDialogOpen] = useState(false);

  if (!canViewInvitations(actorRole)) return null;

  return (
    <section
      aria-label="Undangan"
      className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Undangan</h2>
          <p className="mt-1 text-sm text-slate-600">
            Undang anggota baru lewat email, lalu bagikan link undangannya.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setDialogOpen(true)}
          className="shrink-0 rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-700"
        >
          Undang anggota
        </button>
      </div>

      <div className="mt-5">
        <InvitationList eventId={eventId} />
      </div>

      <InvitationCreateDialog
        eventId={eventId}
        actorRole={actorRole}
        actorMemberId={actorMemberId}
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
      />
    </section>
  );
}
