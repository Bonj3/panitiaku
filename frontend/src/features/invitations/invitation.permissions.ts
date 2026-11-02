/**
 * Helper izin sisi klien untuk undangan — HANYA untuk menyembunyikan
 * tombol/opsi di UI. Backend tetap satu-satunya penegak otorisasi (§4.4).
 */

/** Section undangan hanya terlihat untuk Ketua Event & Ketua Divisi. */
export function canViewInvitations(actorRole: string): boolean {
  return actorRole === "EVENT_CHAIR" || actorRole === "DIVISION_LEADER";
}

/**
 * Pilihan peran saat membuat undangan:
 * - Ketua Event: Ketua Divisi / Anggota.
 * - Ketua Divisi: hanya Anggota (backend menolak dengan 403 bila melanggar).
 */
export function allowedInviteRoles(
  actorRole: string,
): Array<"DIVISION_LEADER" | "MEMBER"> {
  if (actorRole === "EVENT_CHAIR") return ["DIVISION_LEADER", "MEMBER"];
  if (actorRole === "DIVISION_LEADER") return ["MEMBER"];
  return [];
}
