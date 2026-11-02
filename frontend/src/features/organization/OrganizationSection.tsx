import { useEffect, useMemo, useState } from "react";
import { EmptyState } from "@/components/shared/EmptyState";
import { ErrorState } from "@/components/shared/ErrorState";
import { LoadingState } from "@/components/shared/LoadingState";
import { ApiError } from "@/lib/api-client";
import { MemberDetailPanel } from "./MemberDetailPanel";
import { MemberTable } from "./MemberTable";
import { OrganizationChart } from "./OrganizationChart";
import { getClientSubtreeIds } from "./organization.permissions";
import type { OrganizationTree } from "./organization.types";
import { useMember, useOrganization } from "./use-organization";

type OrgTab = "chart" | "members";

interface OrganizationSectionProps {
  eventId: string;
  /** Role aktor yang login (dari GET /events/:eventId membership). */
  actorRole: string;
  /** Id event-member milik aktor (= membership.id, bukan user id). */
  actorMemberId: string;
}

/**
 * Section organisasi di EventDetailPage: tab "Struktur Organisasi"
 * (chart + panel detail) dan tab "Anggota" (tabel). Id member terpilih
 * dipakai bersama kedua tab (chart ↔ tabel sinkron).
 */
export function OrganizationSection({
  eventId,
  actorRole,
  actorMemberId,
}: OrganizationSectionProps) {
  const [tab, setTab] = useState<OrgTab>("chart");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const orgQuery = useOrganization(eventId);

  // Bersihkan pilihan saat ganti event agar tidak menunjuk node event lain.
  useEffect(() => {
    setSelectedId(null);
  }, [eventId]);

  const tree = orgQuery.data ?? null;

  const leaderSubtreeIds = useMemo(() => {
    if (!tree || actorRole !== "DIVISION_LEADER" || !actorMemberId)
      return null;
    return getClientSubtreeIds(tree, actorMemberId);
  }, [tree, actorRole, actorMemberId]);

  return (
    <section
      aria-label="Organisasi"
      className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm"
    >
      <div
        role="tablist"
        aria-label="Tab organisasi"
        className="flex gap-1 border-b border-slate-200"
      >
        <TabButton
          id="org-tab-chart"
          active={tab === "chart"}
          onClick={() => setTab("chart")}
        >
          Struktur Organisasi
        </TabButton>
        <TabButton
          id="org-tab-members"
          active={tab === "members"}
          onClick={() => setTab("members")}
        >
          Anggota
        </TabButton>
      </div>

      <div className="pt-5">
        {orgQuery.isLoading ? (
          <LoadingState label="Memuat struktur organisasi…" />
        ) : orgQuery.error ? (
          orgQuery.error instanceof ApiError &&
          orgQuery.error.status === 403 ? (
            <ErrorState
              title="Tidak punya akses ke struktur organisasi"
              error="Anda bukan anggota aktif event ini, atau keanggotaan Anda sudah dinonaktifkan."
            />
          ) : orgQuery.error instanceof ApiError &&
            orgQuery.error.status === 404 ? (
            <EmptyState
              title="Struktur belum tersedia"
              description="Event ini belum memiliki struktur organisasi."
            />
          ) : (
            <ErrorState
              error={orgQuery.error}
              onRetry={() => orgQuery.refetch()}
            />
          )
        ) : tree ? (
          tree.nodes.length === 0 ? (
            <EmptyState
              title="Struktur belum tersedia"
              description="Event ini belum memiliki anggota dalam struktur."
            />
          ) : tab === "chart" ? (
            <ChartTab
              eventId={eventId}
              tree={tree}
              actorRole={actorRole}
              actorMemberId={actorMemberId}
              leaderSubtreeIds={leaderSubtreeIds}
              selectedId={selectedId}
              onSelect={setSelectedId}
            />
          ) : (
            <MembersTab
              eventId={eventId}
              tree={tree}
              actorRole={actorRole}
              actorMemberId={actorMemberId}
              leaderSubtreeIds={leaderSubtreeIds}
              selectedId={selectedId}
              onSelect={(memberId) => {
                setSelectedId(memberId);
                setTab("chart");
              }}
              onSelectInline={setSelectedId}
            />
          )
        ) : null}
      </div>
    </section>
  );
}

function TabButton({
  id,
  active,
  onClick,
  children,
}: {
  id: string;
  active: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      id={id}
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition ${
        active
          ? "border-slate-900 text-slate-900"
          : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-800"
      }`}
    >
      {children}
    </button>
  );
}

interface ChartTabProps {
  eventId: string;
  tree: OrganizationTree;
  actorRole: string;
  actorMemberId: string;
  leaderSubtreeIds: Set<string> | null;
  selectedId: string | null;
  onSelect: (memberId: string) => void;
}

/**
 * Tab bagan: chart React Flow + panel detail anggota terpilih.
 * Default terpilih: root bila belum ada pilihan.
 */
function ChartTab({
  eventId,
  tree,
  actorRole,
  actorMemberId,
  leaderSubtreeIds,
  selectedId,
  onSelect,
}: ChartTabProps) {
  const effectiveId = selectedId ?? tree.root;
  const memberQuery = useMember(eventId, effectiveId);

  return (
    <div className="space-y-4">
      <OrganizationChart
        tree={tree}
        selectedId={effectiveId}
        onSelect={onSelect}
      />

      {memberQuery.isLoading ? (
        <LoadingState label="Memuat detail anggota…" />
      ) : memberQuery.error ? (
        <ErrorState
          error={memberQuery.error}
          onRetry={() => memberQuery.refetch()}
        />
      ) : memberQuery.data ? (
        <MemberDetailPanel
          eventId={eventId}
          detail={memberQuery.data}
          tree={tree}
          actorRole={actorRole}
          actorMemberId={actorMemberId}
          rootId={tree.root}
          leaderSubtreeIds={leaderSubtreeIds}
          onNavigate={onSelect}
        />
      ) : null}
    </div>
  );
}

interface MembersTabProps {
  eventId: string;
  tree: OrganizationTree;
  actorRole: string;
  actorMemberId: string;
  leaderSubtreeIds: Set<string> | null;
  selectedId: string | null;
  /** Pilih dari tabel lalu pindah ke tab bagan. */
  onSelect: (memberId: string) => void;
  /** Pilih inline (highlight baris saja, tetap di tab anggota). */
  onSelectInline: (memberId: string) => void;
}

/**
 * Tab anggota: tabel + panel detail di bawahnya bila ada pilihan.
 */
function MembersTab({
  eventId,
  tree,
  actorRole,
  actorMemberId,
  leaderSubtreeIds,
  selectedId,
  onSelect,
  onSelectInline,
}: MembersTabProps) {
  const effectiveId = selectedId ?? null;
  const memberQuery = useMember(eventId, effectiveId);

  return (
    <div className="space-y-4">
      <MemberTable
        eventId={eventId}
        selectedId={effectiveId}
        onSelect={onSelectInline}
      />
      {effectiveId ? (
        <div>
          {memberQuery.isLoading ? (
            <LoadingState label="Memuat detail anggota…" />
          ) : memberQuery.error ? (
            <ErrorState
              error={memberQuery.error}
              onRetry={() => memberQuery.refetch()}
            />
          ) : memberQuery.data ? (
            <div className="space-y-3">
              <button
                type="button"
                onClick={() => onSelect(effectiveId)}
                className="text-sm font-medium text-slate-600 underline underline-offset-4 hover:text-slate-900"
              >
                Lihat di bagan →
              </button>
              <MemberDetailPanel
                eventId={eventId}
                detail={memberQuery.data}
                tree={tree}
                actorRole={actorRole}
                actorMemberId={actorMemberId}
                rootId={tree.root}
                leaderSubtreeIds={leaderSubtreeIds}
                onNavigate={onSelectInline}
              />
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
