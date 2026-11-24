import { keepPreviousData, QueryClient, useQuery, type QueryKey } from "@tanstack/react-query";
import type { DialogueSession } from "@shared/schemas/models";
import type { SessionSSEEvent } from "@shared/schemas/events";
import { api, ApiError } from "@/lib/api";

export const queryKeys = {
  sessions: ["sessions"] as const,
  session: (id: string) => ["session", id] as const,
  speechStatus: ["speech", "status"] as const,
  mapperConfig: ["mapper", "config"] as const,
  voices: ["voices"] as const,
} satisfies Record<string, QueryKey | ((...args: string[]) => QueryKey)>;

export function isUnauthorized(err: unknown): boolean {
  return err instanceof ApiError && err.status === 401;
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Don't hammer the server with retries for auth failures or missing sessions
      retry: (failureCount, err) =>
        !(err instanceof ApiError && err.status < 500) && failureCount < 2,
      staleTime: 30_000,
    },
  },
});

export function useSessionsQuery() {
  return useQuery({
    queryKey: queryKeys.sessions,
    queryFn: async () => (await api.listSessions()).sessions,
  });
}

/**
 * The open session. Its live SSE stream keeps this cache entry current (see
 * applySessionEvent), so it never goes stale on its own or refetches on focus.
 * While switching to a session that isn't cached yet, the previous one stays as
 * placeholder data (`isPlaceholderData`), so the screen doesn't drop back to a skeleton.
 */
export function useSessionQuery(id: string | null) {
  return useQuery({
    queryKey: queryKeys.session(id ?? ""),
    queryFn: async () => (await api.getSession(id!)).session,
    enabled: Boolean(id),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    placeholderData: keepPreviousData,
  });
}

export function useSpeechStatusQuery() {
  return useQuery({ queryKey: queryKeys.speechStatus, queryFn: api.getSpeechStatus });
}

export function useMapperConfigQuery() {
  return useQuery({ queryKey: queryKeys.mapperConfig, queryFn: api.getMapperConfig });
}

export function useVoicesQuery() {
  return useQuery({
    queryKey: queryKeys.voices,
    queryFn: async () => (await api.listVoices()).voices,
  });
}

/** Puts a session the server just returned into the cache. */
export function cacheSession(session: DialogueSession): void {
  queryClient.setQueryData(queryKeys.session(session.id), session);
}

export function invalidateSessions(): Promise<void> {
  return queryClient.invalidateQueries({ queryKey: queryKeys.sessions });
}

/** Applies one live SSE event to a cached session. Pure: returns the next session. */
export function reduceSessionEvent(
  prev: DialogueSession,
  evt: SessionSSEEvent
): DialogueSession {
  switch (evt.type) {
    case "session.snapshot":
      return evt.session;

    case "session.updated":
      return { ...prev, title: evt.title, rootFocus: evt.rootFocus, autoMap: evt.autoMap };

    case "session.audio":
      return { ...prev, audio: evt.audio, updatedAt: new Date().toISOString() };

    case "session.context_updated": {
      const hostSet = new Set(evt.hostTurnIds || []);
      return {
        ...prev,
        hostContext: evt.hostContext,
        turns:
          hostSet.size > 0
            ? prev.turns.map((t) => (hostSet.has(t.id) ? { ...t, kind: "host_context" } : t))
            : prev.turns,
      };
    }

    case "speaker.updated": {
      const exists = prev.speakers.some((s) => s.id === evt.speaker.id);
      const speakers = exists
        ? prev.speakers.map((s) => (s.id === evt.speaker.id ? evt.speaker : s))
        : [...prev.speakers, evt.speaker].sort((a, b) => a.channel - b.channel);
      return { ...prev, speakers };
    }

    case "transcript.turn":
      if (prev.turns.some((t) => t.id === evt.turn.id)) return prev;
      return { ...prev, turns: [...prev.turns, evt.turn] };

    case "transcript.turn_updated":
      return {
        ...prev,
        turns: prev.turns.map((t) => (t.id === evt.turn.id ? evt.turn : t)),
      };

    case "transcript.turns_batch": {
      const existingIds = new Set(prev.turns.map((t) => t.id));
      const fresh = evt.turns.filter((t) => !existingIds.has(t.id));
      return { ...prev, turns: [...prev.turns, ...fresh] };
    }

    case "map.updated": {
      const activity = evt.activity
        ? [...prev.activity.slice(-79), evt.activity]
        : prev.activity;
      // Mark turns referenced by nodes as mapped locally too
      const referencedTurns = new Set<string>();
      for (const n of evt.nodes) {
        for (const tid of n.turnIds) referencedTurns.add(tid);
      }
      const turns = prev.turns.map((t) =>
        referencedTurns.has(t.id) ? { ...t, mapped: true } : t
      );
      return { ...prev, nodes: evt.nodes, crossLinks: evt.crossLinks, activity, turns };
    }

    // Transient status events don't change the session itself
    case "transcript.partial":
    case "mapper.status":
    case "speech.status":
      return prev;
  }
}

/** Writes a live SSE event into the cached session (and the session list when titles/counts change). */
export function applySessionEvent(sessionId: string, evt: SessionSSEEvent): void {
  const key = queryKeys.session(sessionId);
  if (evt.type === "session.snapshot") {
    queryClient.setQueryData(key, evt.session);
  } else {
    queryClient.setQueryData<DialogueSession>(key, (prev) =>
      prev ? reduceSessionEvent(prev, evt) : prev
    );
  }
  if (evt.type === "session.updated" || evt.type === "map.updated") {
    void invalidateSessions();
  }
}
