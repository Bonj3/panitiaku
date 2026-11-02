import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { ApiError } from "@/lib/api-client";
import { queryKeys } from "@/lib/query-keys";
import { eventService } from "./event.service";
import type { CreateEventInput, UpdateEventInput } from "./event.types";

/**
 * Hooks TanStack Query untuk domain event.
 * Query key hierarkis: ['events', eventId] via `queryKeys.events.detail`.
 */

/** Buat event → invalidasi ['auth','me'] (daftar event) → redirect ke detail. */
export function useCreateEvent() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  return useMutation({
    mutationFn: (input: CreateEventInput) => eventService.createEvent(input),
    onSuccess: async (data) => {
      // Daftar event di EventsPage berasal dari GET /auth/me.
      await queryClient.invalidateQueries({ queryKey: queryKeys.auth.me });
      void navigate(`/events/${data.event.id}`);
    },
  });
}

/**
 * Detail event. `retry: false` agar 403/404 langsung ditangani UI
 * (pesan khusus tanpa retry) dan tidak ada pengulangan sia-sia.
 */
export function useEvent(eventId: string | undefined) {
  return useQuery({
    queryKey: eventId
      ? queryKeys.events.detail(eventId)
      : (["events", "detail", "missing"] as const),
    queryFn: () => eventService.getEvent(eventId as string),
    enabled: Boolean(eventId),
    retry: false,
    staleTime: 30_000,
  });
}

/** Tutup event → invalidasi cache detail event + sesi (daftar event). */
export function useCloseEvent(eventId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => eventService.closeEvent(eventId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.events.detail(eventId),
      });
      // BR-15: penutupan event membatalkan transaksi berjalan dan dapat
      // mengubah ringkasan/daftar keuangan.
      await queryClient.invalidateQueries({
        queryKey: ["events", eventId, "finance"],
      });
      await queryClient.invalidateQueries({
        queryKey: ["events", eventId, "transactions"],
      });
      await queryClient.invalidateQueries({ queryKey: queryKeys.auth.me });
    },
  });
}

/** Ubah event (dipakai fase berikutnya; diekspos agar kontrak lengkap). */
export function useUpdateEvent(eventId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: UpdateEventInput) =>
      eventService.updateEvent(eventId, input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.events.detail(eventId),
      });
      await queryClient.invalidateQueries({ queryKey: queryKeys.auth.me });
    },
  });
}

/** True bila error adalah ApiError dengan salah satu status HTTP berikut. */
export function isApiStatus(error: unknown, ...statuses: number[]): boolean {
  return error instanceof ApiError && statuses.includes(error.status);
}
