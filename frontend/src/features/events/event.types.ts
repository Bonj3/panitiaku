/**
 * Tipe kontrak event (PROJECT.md §13.3, terverifikasi terhadap
 * backend `event.service.ts` + `event.controller.ts`).
 *
 * Catatan: GET /events/:eventId dan POST /events saat ini hanya
 * mengembalikan `{ id, name, slug, status }` untuk event (tanpa deskripsi
 * maupun timestamp). Field `description` didefinisikan opsional agar
 * tetap kompatibel bila backend menambahkannya di fase berikutnya —
 * JANGAN menghitung/menekanya dari sisi frontend.
 */

/** Status event: OPEN (aktif) atau CLOSED (ditutup). */
export type EventStatus = "OPEN" | "CLOSED";

/** Peran keanggotaan dalam satu event. */
export type EventRole = "EVENT_CHAIR" | "DIVISION_LEADER" | "MEMBER";

/** Status keanggotaan dalam satu event. */
export type EventMembershipStatus = "ACTIVE" | "INACTIVE";

export interface Event {
  id: string;
  name: string;
  slug: string;
  status: EventStatus;
  /** Tidak dikembalikan backend saat ini; opsional untuk kompatibilitas. */
  description?: string | null;
}

export interface EventMembership {
  id: string;
  eventId: string;
  userId: string;
  role: EventRole;
  status: EventMembershipStatus;
  event: Pick<Event, "id" | "name" | "slug" | "status">;
}

export interface CreateEventInput {
  name: string;
  slug?: string;
  description?: string;
}

export interface UpdateEventInput {
  name?: string;
  description?: string | null;
}

export interface EventDetailResponse {
  event: Event;
  membership: EventMembership;
}

export interface CloseEventResponse {
  cancelledCount: number;
}
