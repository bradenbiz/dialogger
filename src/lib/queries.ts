import useSWR, { mutate, type SWRConfiguration } from "swr";
import type { DialogueSession } from "@shared/schemas/models";
import type { SessionSSEEvent } from "@shared/schemas/events";
import { api, ApiError, type SessionSummary } from "@/lib/api";

/** SWR cache keys. A `null` key (see useSession) means "nothing to fetch yet": no cache entry. */
export const keys = {
  sessions: ["sessions"] as const,
  session: (id: string) => ["session", id] as const,
  speechStatus: ["speech", "status"] as const,
  mapperConfig: ["mapper", "config"] as const,
  voices: ["voices"] as const,
};

export function isUnauthorized(err: unknown): boolean {
  return err instanceof ApiError && err.status === 401;
}

/** App-wide SWR options (passed to <SWRConfig> in main.tsx). */
export const swrConfig: SWRConfiguration = {
  // Don't hammer the server with retries for auth failures or missing sessions
  onErrorRetry: (err, _key, _config, revalidate, { retryCount }) => {
    if (err instanceof ApiError && err.status < 500) return;
    if (retryCount >= 2) return;
    setTimeout(() => void revalidate({ retryCount }), 1000 * 2 ** retryCount);
  },
};

export function useSessions() {
  return useSWR<SessionSummary[]>(keys.sessions, async () => (await api.listSessions()).sessions);
}

/**
 * The open session; `null` while none is chosen yet. Its live SSE stream keeps this cache
 * entry current (see applySessionEvent), so it never revalidates on its own. While switching
 * to a session that isn't cached yet, the previous one stays as `data` (keepPreviousData).
 */
export function useSession(id: string | null) {
  return useSWR<DialogueSession>(
    id ? keys.session(id) : null,
    async ([, sessionId]: readonly [string, string]) => (await api.getSession(sessionId)).session,
    {
      keepPreviousData: true,
      revalidateIfStale: false,
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
    }
  );
}

export function useSpeechStatus() {
  return useSWR(keys.speechStatus, () => api.getSpeechStatus());
}

export function useMapperConfig() {
  return useSWR(keys.mapperConfig, () => api.getMapperConfig());
}

export function useVoices() {
  return useSWR(keys.voices, async () => (await api.listVoices()).voices);
}

/** Puts a session the server just returned into the cache. */
export function cacheSession(session: DialogueSession): void {
  void mutate(keys.session(session.id), session, { revalidate: false });
}

/** Refetches the session list; resolves to the fresh list. */
export function invalidateSessions(): Promise<SessionSummary[] | undefined> {
  return mutate<SessionSummary[]>(keys.sessions);
}

/** Refetches everything cached (e.g. after signing in, when it all failed with 401). */
export function revalidateAll(): Promise<unknown[]> {
  return mutate(() => true);
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
  const key = keys.session(sessionId);
  if (evt.type === "session.snapshot") {
    void mutate(key, evt.session, { revalidate: false });
  } else {
    void mutate<DialogueSession>(key, (prev) => (prev ? reduceSessionEvent(prev, evt) : prev), {
      revalidate: false,
    });
  }
  if (evt.type === "session.updated" || evt.type === "map.updated") {
    void invalidateSessions();
  }
}
