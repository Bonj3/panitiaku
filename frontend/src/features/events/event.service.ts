import { apiClient } from "@/lib/api-client";
import type {
  CloseEventResponse,
  CreateEventInput,
  Event,
  EventDetailResponse,
  UpdateEventInput,
} from "./event.types";

/**
 * Lapisan service event di atas api-client terpusat.
 * Satu-satunya lapisan yang boleh memanggil HTTP untuk domain event —
 * komponen UI memanggil hooks (`use-events.ts`), bukan service ini langsung.
 */
export const eventService = {
  /** POST /events → 201 { event, membership }. */
  createEvent(input: CreateEventInput): Promise<EventDetailResponse> {
    return apiClient.post<EventDetailResponse>("/events", input);
  },

  /** GET /events/:eventId → 200 { event, membership }. */
  getEvent(eventId: string): Promise<EventDetailResponse> {
    return apiClient.get<EventDetailResponse>(
      `/events/${encodeURIComponent(eventId)}`,
    );
  },

  /** PATCH /events/:eventId → 200 { event }. */
  updateEvent(eventId: string, input: UpdateEventInput): Promise<{ event: Event }> {
    return apiClient.patch<{ event: Event }>(
      `/events/${encodeURIComponent(eventId)}`,
      input,
    );
  },

  /** POST /events/:eventId/close { confirm: true } → 200 { cancelledCount }. */
  closeEvent(eventId: string): Promise<CloseEventResponse> {
    return apiClient.post<CloseEventResponse>(
      `/events/${encodeURIComponent(eventId)}/close`,
      { confirm: true },
    );
  },
};
