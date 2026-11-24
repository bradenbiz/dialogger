import { sessionStore } from "./store";
import { dialogueMapper } from "./mapper";

// Unified per-session serialized mapping queue + active transcription/live job ownership
const mapQueues = new Map<string, Promise<void>>();
export const activeTranscribeJobs = new Map<string, AbortController>();
const activeLiveJobs = new Map<string, Set<AbortController>>();

export function isCurrentJob(sessionId: string, ctrl: AbortController): boolean {
  return activeTranscribeJobs.get(sessionId) === ctrl && !ctrl.signal.aborted;
}

/** Cancels any running job on the session and registers a new one. */
export function startTranscribeJob(sessionId: string): AbortController {
  cancelActiveTranscribe(sessionId);
  const ctrl = new AbortController();
  activeTranscribeJobs.set(sessionId, ctrl);
  return ctrl;
}

export function finishTranscribeJob(sessionId: string, ctrl: AbortController): void {
  if (activeTranscribeJobs.get(sessionId) === ctrl) {
    activeTranscribeJobs.delete(sessionId);
  }
}

export function registerLiveController(
  sessionId: string,
  ctrl: AbortController
): () => void {
  let set = activeLiveJobs.get(sessionId);
  if (!set) {
    set = new Set();
    activeLiveJobs.set(sessionId, set);
  }
  set.add(ctrl);
  return () => {
    set?.delete(ctrl);
    if (set && set.size === 0 && activeLiveJobs.get(sessionId) === set) {
      activeLiveJobs.delete(sessionId);
    }
  };
}

function cancelLiveWork(sessionId: string): void {
  const set = activeLiveJobs.get(sessionId);
  if (!set) return;
  for (const ctrl of set) {
    ctrl.abort();
  }
  activeLiveJobs.delete(sessionId);
}

export function cancelActiveTranscribe(sessionId: string): boolean {
  cancelLiveWork(sessionId);
  const ctrl = activeTranscribeJobs.get(sessionId);
  if (!ctrl) return false;
  activeTranscribeJobs.delete(sessionId);
  ctrl.abort();
  sessionStore.broadcast(sessionId, { type: "speech.status", state: "idle" });
  sessionStore.broadcast(sessionId, {
    type: "transcript.partial",
    text: "",
    timestamp: new Date().toISOString(),
  });
  return true;
}

export function enqueueMapRun(
  sessionId: string,
  options?: { force?: boolean; turnIds?: string[] }
): Promise<void> {
  const prev = mapQueues.get(sessionId) || Promise.resolve();
  const next = prev
    .catch(() => {})
    .then(async () => {
      const session = sessionStore.getSession(sessionId);
      if (!session) return;
      if (!options?.force && !session.autoMap) return;

      const startGen = sessionStore.getGeneration(sessionId);
      const idFilter = options?.turnIds ? new Set(options.turnIds) : null;
      const unmapped = session.turns.filter(
        (t) => !t.mapped && (!idFilter || idFilter.has(t.id))
      );
      if (unmapped.length === 0) return;

      sessionStore.broadcast(sessionId, {
        type: "mapper.status",
        status: "analyzing",
        message: `Mapping ${unmapped.length} new turn${unmapped.length === 1 ? "" : "s"}…`,
      });

      try {
        const batch = await dialogueMapper.analyzeTurns(session, unmapped);
        // Discard stale results if session was trimmed, reset, replaced, or deleted mid-inference
        if (
          !sessionStore.getSession(sessionId) ||
          sessionStore.getGeneration(sessionId) !== startGen
        ) {
          sessionStore.broadcast(sessionId, {
            type: "mapper.status",
            status: "idle",
          });
          return;
        }
        const { fallbackReason, ...ops } = batch;
        if (ops.ops.length > 0 || (ops.markTurnIdsMapped?.length ?? 0) > 0) {
          sessionStore.applyMapOps(sessionId, ops);
        }
        // The LLM failed and the heuristic mapped instead: say so, or it looks like it worked
        sessionStore.broadcast(sessionId, {
          type: "mapper.status",
          ...(fallbackReason
            ? { status: "error", message: fallbackReason }
            : { status: "idle" }),
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("[autoMap] error:", msg);
        sessionStore.broadcast(sessionId, {
          type: "mapper.status",
          status: "error",
          message: msg,
        });
      }
    });

  mapQueues.set(sessionId, next);
  return next.finally(() => {
    if (mapQueues.get(sessionId) === next) {
      mapQueues.delete(sessionId);
    }
  });
}

export async function runAutoMap(sessionId: string): Promise<void> {
  await enqueueMapRun(sessionId, { force: false });
}

/** Maps freshly added batch-transcribed turns a few at a time so the map fills in progressively. */
export async function mapAddedTurnsInChunks(
  sessionId: string,
  ctrl: AbortController,
  turnIds: string[]
): Promise<void> {
  const chunkSize = 4;
  for (let i = 0; i < turnIds.length; i += chunkSize) {
    if (!isCurrentJob(sessionId, ctrl)) break;
    await enqueueMapRun(sessionId, {
      force: true,
      turnIds: turnIds.slice(i, i + chunkSize),
    });
  }
}

/** Broadcasts a speech error for the job unless it was superseded. */
export function reportJobError(
  sessionId: string,
  ctrl: AbortController,
  err: unknown
): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (isCurrentJob(sessionId, ctrl)) {
    sessionStore.broadcast(sessionId, {
      type: "speech.status",
      state: "error",
      message: msg,
    });
  }
  return msg;
}

export function broadcastJobIdle(sessionId: string): void {
  sessionStore.broadcast(sessionId, { type: "speech.status", state: "idle" });
  sessionStore.broadcast(sessionId, {
    type: "transcript.partial",
    text: "",
    timestamp: new Date().toISOString(),
  });
}

// --- Built-in live demo timers ---

const activeDemoTimers = new Map<string, NodeJS.Timeout[]>();

export function stopDemo(sessionId: string): void {
  const timers = activeDemoTimers.get(sessionId);
  if (timers) {
    for (const t of timers) clearTimeout(t);
    activeDemoTimers.delete(sessionId);
  }
}

export function setDemoTimers(sessionId: string, timers: NodeJS.Timeout[]): void {
  activeDemoTimers.set(sessionId, timers);
}

export function clearDemoTimers(sessionId: string): void {
  activeDemoTimers.delete(sessionId);
}
