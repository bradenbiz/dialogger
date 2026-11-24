import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {
  type DialogueSession,
  type HostContextItem,
  type IBISNode,
  type IBISOpBatch,
  type MapActivityEntry,
  type SessionAudioMeta,
  type Speaker,
  type TranscriptTurn,
} from "../shared/schemas/models";
import { defaultRelationLabel, SPEAKER_PALETTE } from "../shared/ibis";
import type { SessionSSEEvent } from "../shared/schemas/events";

type Listener = (event: SessionSSEEvent) => void;

const DEFAULT_DATA_DIR =
  process.env.DIALOGGER_DATA_DIR || path.resolve(process.cwd(), ".dialogger-data");

function nowIso(): string {
  return new Date().toISOString();
}

function shortId(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(4).toString("hex")}`;
}

function isGenericSpeakerName(name: string): boolean {
  return /^Speaker\s+\d+$/i.test(name.trim());
}

export interface DiarizationWindowContext {
  slotToSpeakerId: Map<number, string>;
  claimedSpeakerIds: Set<string>;
  seedNamesBySlot?: Map<number, string>;
  seedsInitialized?: boolean;
}

export function createDiarizationWindowContext(
  seedNamesBySlot?: Map<number, string>
): DiarizationWindowContext {
  return {
    slotToSpeakerId: new Map(),
    claimedSpeakerIds: new Set(),
    seedNamesBySlot: seedNamesBySlot ? new Map(seedNamesBySlot) : undefined,
    seedsInitialized: false,
  };
}

export class SessionStore {
  private sessions = new Map<string, DialogueSession>();
  private listeners = new Map<string, Set<Listener>>();
  private generations = new Map<string, number>();
  private readonly dataDir: string;
  private readonly audioDir: string;
  private readonly storeFile: string;

  constructor(dataDir?: string) {
    this.dataDir = dataDir ? path.resolve(dataDir) : DEFAULT_DATA_DIR;
    this.audioDir = path.join(this.dataDir, "audio");
    this.storeFile = path.join(this.dataDir, "sessions.json");
    this.loadFromDisk();
  }

  getGeneration(id: string): number {
    return this.generations.get(id) || 0;
  }

  bumpGeneration(id: string): number {
    const next = (this.generations.get(id) || 0) + 1;
    this.generations.set(id, next);
    return next;
  }

  private loadFromDisk(): void {
    try {
      if (!fs.existsSync(this.storeFile)) return;
      const raw = fs.readFileSync(this.storeFile, "utf8");
      const parsed = JSON.parse(raw) as DialogueSession[];
      if (Array.isArray(parsed)) {
        for (const s of parsed) {
          if (s && typeof s.id === "string") {
            if (!Array.isArray(s.hostContext)) s.hostContext = [];
            this.sessions.set(s.id, s);
          }
        }
      }
    } catch (err) {
      console.warn("[store] Failed to load persisted sessions:", err);
    }
  }

  private persist(): void {
    try {
      fs.mkdirSync(this.dataDir, { recursive: true });
      const all = Array.from(this.sessions.values());
      const tmp = `${this.storeFile}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(all, null, 2), "utf8");
      fs.renameSync(tmp, this.storeFile);
    } catch (err) {
      console.warn("[store] Failed to persist sessions:", err);
    }
  }

  subscribe(sessionId: string, listener: Listener): () => void {
    let set = this.listeners.get(sessionId);
    if (!set) {
      set = new Set();
      this.listeners.set(sessionId, set);
    }
    set.add(listener);
    return () => {
      set?.delete(listener);
      if (set && set.size === 0) {
        this.listeners.delete(sessionId);
      }
    };
  }

  broadcast(sessionId: string, event: SessionSSEEvent): void {
    const set = this.listeners.get(sessionId);
    if (!set) return;
    for (const listener of set) {
      try {
        listener(event);
      } catch {
        // Ignore broken client listeners
      }
    }
  }

  listSessions(): Array<{
    id: string;
    title: string;
    rootFocus?: string;
    createdAt: string;
    updatedAt: string;
    nodeCount: number;
    turnCount: number;
    speakerCount: number;
  }> {
    return Array.from(this.sessions.values())
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((s) => ({
        id: s.id,
        title: s.title,
        rootFocus: s.rootFocus,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
        nodeCount: s.nodes.length,
        turnCount: s.turns.length,
        speakerCount: s.speakers.length,
      }));
  }

  getSession(id: string): DialogueSession | undefined {
    return this.sessions.get(id);
  }

  createSession(input?: {
    title?: string;
    rootFocus?: string;
    autoMap?: boolean;
    speechConfig?: Partial<DialogueSession["speechConfig"]>;
  }): DialogueSession {
    const now = nowIso();
    const session: DialogueSession = {
      id: shortId("dlg"),
      title: input?.title?.trim() || "Untitled Dialogue Map",
      rootFocus: input?.rootFocus?.trim() || undefined,
      createdAt: now,
      updatedAt: now,
      speakers: [],
      turns: [],
      nodes: [],
      crossLinks: [],
      hostContext: [],
      activity: [],
      speechConfig: {
        streamingAsrModel:
          input?.speechConfig?.streamingAsrModel ||
          process.env.NEMO_SPEECH_STREAMING_ASR ||
          "nemotron-3.5",
        offlineAsrModel:
          input?.speechConfig?.offlineAsrModel ||
          process.env.NEMO_SPEECH_OFFLINE_ASR ||
          "parakeet-tdt",
        diarizationModel:
          input?.speechConfig?.diarizationModel ||
          process.env.NEMO_SPEECH_DIAR_MODEL ||
          "nemotron-3-diarization",
      },
      autoMap: input?.autoMap ?? true,
    };

    if (session.rootFocus) {
      session.nodes.push({
        id: shortId("q"),
        type: "question",
        label: session.rootFocus.endsWith("?")
          ? session.rootFocus
          : `${session.rootFocus}?`,
        parentId: null,
        relationLabel: "root",
        turnIds: [],
        speakerIds: [],
        createdAt: now,
        updatedAt: now,
        createdBy: "human",
      });
    }

    this.sessions.set(session.id, session);
    this.persist();
    return session;
  }

  deleteSession(id: string): boolean {
    const existing = this.sessions.get(id);
    const deleted = this.sessions.delete(id);
    if (deleted) {
      this.bumpGeneration(id);
      this.listeners.delete(id);
      if (existing?.audio?.filename) {
        try {
          fs.unlinkSync(path.join(this.audioDir, existing.audio.filename));
        } catch {
          // ignore
        }
      }
      this.persist();
    }
    return deleted;
  }

  getAudioFilePath(id: string): string | null {
    const session = this.sessions.get(id);
    if (!session?.audio?.filename) return null;
    const full = path.join(this.audioDir, session.audio.filename);
    return fs.existsSync(full) ? full : null;
  }

  getAudioDir(): string {
    fs.mkdirSync(this.audioDir, { recursive: true });
    return this.audioDir;
  }

  setSessionAudio(
    id: string,
    audio: SessionAudioMeta
  ): DialogueSession | undefined {
    const session = this.sessions.get(id);
    if (!session) return undefined;
    session.audio = audio;
    session.updatedAt = nowIso();
    this.persist();
    this.broadcast(id, { type: "session.audio", audio });
    return session;
  }

  clearForFreshRun(
    id: string,
    preserveManualHostContext = true
  ): DialogueSession | undefined {
    const session = this.sessions.get(id);
    if (!session) return undefined;
    this.bumpGeneration(id);
    session.turns = [];
    session.speakers = [];
    session.nodes = [];
    session.crossLinks = [];
    session.hostContext = preserveManualHostContext
      ? (session.hostContext || []).filter((hc) => hc.turnIds.length === 0)
      : [];
    session.activity = [];
    session.updatedAt = nowIso();
    this.persist();
    this.broadcast(id, { type: "session.snapshot", session });
    return session;
  }

  truncateTurnsFrom(id: string, fromSec: number): DialogueSession | undefined {
    const session = this.sessions.get(id);
    if (!session) return undefined;
    const cutoff = Math.max(0, fromSec);

    let changed = false;
    const keptTurns: TranscriptTurn[] = [];
    const clippedTurnIds = new Set<string>();

    for (const t of session.turns) {
      if (t.startSec >= cutoff) {
        changed = true;
        continue;
      }
      if (t.endSec <= cutoff) {
        keptTurns.push(t);
        continue;
      }

      // Boundary turn crosses the exact playhead: clip words and rebuild text (S7)
      changed = true;
      if (t.words && t.words.length > 0) {
        const retainedWords = t.words
          .filter((w) => (w.start + w.end) / 2 < cutoff)
          .map((w) => {
            const s = Math.min(cutoff, w.start);
            const e = Math.max(s, Math.min(cutoff, w.end));
            return {
              ...w,
              start: Number(s.toFixed(2)),
              end: Number(e.toFixed(2)),
            };
          });
        if (retainedWords.length === 0) continue;

        let rebuiltText = "";
        for (const w of retainedWords) {
          const tok = w.word.trim();
          if (!tok) continue;
          if (!rebuiltText) rebuiltText = tok;
          else rebuiltText += (/^[,.;:!?)]/.test(tok) ? "" : " ") + tok;
        }
        clippedTurnIds.add(t.id);
        keptTurns.push({
          ...t,
          text: rebuiltText || t.text,
          startSec: retainedWords[0].start,
          endSec: retainedWords[retainedWords.length - 1].end,
          words: retainedWords,
          mapped: false,
        });
      } else {
        clippedTurnIds.add(t.id);
        keptTurns.push({
          ...t,
          endSec: Number(cutoff.toFixed(2)),
          mapped: false,
        });
      }
    }

    if (!changed) return session;

    this.bumpGeneration(id);
    session.turns = keptTurns;
    const keptIds = new Set(keptTurns.map((t) => t.id));

    // Remove map nodes whose provenance came solely from replaced/clipped turns (S7)
    const removedNodeParent = new Map<string, string | null>();
    const keptNodes: IBISNode[] = [];
    for (const n of session.nodes) {
      const wasAutomatic = n.turnIds.length > 0;
      const survivingTurns = n.turnIds.filter(
        (tid) => keptIds.has(tid) && !clippedTurnIds.has(tid)
      );
      if (wasAutomatic && survivingTurns.length === 0) {
        removedNodeParent.set(n.id, n.parentId);
      } else {
        n.turnIds = survivingTurns;
        keptNodes.push(n);
      }
    }
    const keptNodeIds = new Set(keptNodes.map((n) => n.id));
    for (const n of keptNodes) {
      let parent = n.parentId;
      const seen = new Set<string>();
      while (parent && !keptNodeIds.has(parent) && !seen.has(parent)) {
        seen.add(parent);
        parent = removedNodeParent.get(parent) ?? null;
      }
      n.parentId = parent && keptNodeIds.has(parent) ? parent : null;
    }
    session.nodes = keptNodes;
    session.crossLinks = session.crossLinks.filter(
      (l) => keptNodeIds.has(l.fromId) && keptNodeIds.has(l.toId)
    );

    // Prune automatic hostContext whose turns disappeared; preserve manual hostContext (S7)
    session.hostContext = (session.hostContext || []).reduce<HostContextItem[]>(
      (acc, hc) => {
        const wasManual = hc.turnIds.length === 0;
        if (wasManual) {
          acc.push(hc);
          return acc;
        }
        const surviving = hc.turnIds.filter(
          (tid) => keptIds.has(tid) && !clippedTurnIds.has(tid)
        );
        if (surviving.length > 0) {
          acc.push({ ...hc, turnIds: surviving });
        }
        return acc;
      },
      []
    );

    session.updatedAt = nowIso();
    this.persist();
    this.broadcast(id, { type: "session.snapshot", session });
    return session;
  }

  applyAudioTrimState(
    id: string,
    params: {
      startSec: number;
      endSec?: number;
      newDurationSec: number;
      clearTranscriptAndMap?: boolean;
    }
  ): DialogueSession | undefined {
    const session = this.sessions.get(id);
    if (!session || !session.audio) return undefined;

    this.bumpGeneration(id);
    session.audio = {
      ...session.audio,
      durationSec: params.newDurationSec,
      clipStartSec: Number(
        ((session.audio.clipStartSec || 0) + params.startSec).toFixed(2)
      ),
    };

    if (params.clearTranscriptAndMap) {
      session.turns = [];
      session.speakers = [];
      session.nodes = [];
      session.crossLinks = [];
      session.hostContext = (session.hostContext || []).filter(
        (hc) => hc.turnIds.length === 0
      );
      session.activity = [];
    } else {
      const keptTurnIds = new Set<string>();
      const clipEnd =
        params.endSec !== undefined
          ? params.endSec
          : params.startSec + params.newDurationSec;
      const nextTurns: TranscriptTurn[] = [];

      for (const t of session.turns) {
        if (t.endSec <= params.startSec || t.startSec >= clipEnd) continue;

        if (t.words && t.words.length > 0) {
          const retainedWords = t.words
            .filter((w) => {
              const mid = (w.start + w.end) / 2;
              return mid >= params.startSec && mid <= clipEnd;
            })
            .map((w) => {
              const s = Math.max(
                0,
                Math.min(
                  params.newDurationSec,
                  Number((w.start - params.startSec).toFixed(2))
                )
              );
              const e = Math.max(
                s,
                Math.min(
                  params.newDurationSec,
                  Number((w.end - params.startSec).toFixed(2))
                )
              );
              return { ...w, start: s, end: e };
            });

          if (retainedWords.length === 0) continue;

          let rebuiltText = "";
          for (const w of retainedWords) {
            const tok = w.word.trim();
            if (!tok) continue;
            if (!rebuiltText) rebuiltText = tok;
            else rebuiltText += (/^[,.;:!?)]/.test(tok) ? "" : " ") + tok;
          }

          keptTurnIds.add(t.id);
          nextTurns.push({
            ...t,
            text: rebuiltText || t.text,
            startSec: retainedWords[0].start,
            endSec: retainedWords[retainedWords.length - 1].end,
            words: retainedWords,
          });
        } else {
          const nextStart = Math.max(
            0,
            Math.min(
              params.newDurationSec,
              Number((t.startSec - params.startSec).toFixed(2))
            )
          );
          const nextEnd = Math.max(
            nextStart,
            Math.min(
              params.newDurationSec,
              Number((Math.min(t.endSec, clipEnd) - params.startSec).toFixed(2))
            )
          );
          keptTurnIds.add(t.id);
          nextTurns.push({
            ...t,
            startSec: nextStart,
            endSec: nextEnd,
          });
        }
      }

      session.turns = nextTurns;
      for (const n of session.nodes) {
        n.turnIds = n.turnIds.filter((tid) => keptTurnIds.has(tid));
      }
      // Drop automatically extracted host context whose source turns were all trimmed away;
      // preserve only manual entries (turnIds.length === 0 BEFORE trim) or entries with surviving turns (S8).
      session.hostContext = (session.hostContext || []).reduce<HostContextItem[]>(
        (acc, hc) => {
          const wasManual = hc.turnIds.length === 0;
          if (wasManual) {
            acc.push(hc);
            return acc;
          }
          const surviving = hc.turnIds.filter((tid) => keptTurnIds.has(tid));
          if (surviving.length > 0) {
            acc.push({ ...hc, turnIds: surviving });
          }
          return acc;
        },
        []
      );
    }

    session.updatedAt = nowIso();
    this.persist();
    this.broadcast(id, { type: "session.snapshot", session });
    return session;
  }

  updateSessionMeta(
    id: string,
    patch: {
      title?: string;
      rootFocus?: string;
      autoMap?: boolean;
      speechConfig?: Partial<DialogueSession["speechConfig"]>;
    }
  ): DialogueSession | undefined {
    const session = this.sessions.get(id);
    if (!session) return undefined;
    if (patch.title !== undefined) session.title = patch.title.trim() || session.title;
    if (patch.rootFocus !== undefined) session.rootFocus = patch.rootFocus;
    if (patch.autoMap !== undefined) session.autoMap = patch.autoMap;
    if (patch.speechConfig) {
      session.speechConfig = { ...session.speechConfig, ...patch.speechConfig };
    }
    session.updatedAt = nowIso();
    this.persist();
    this.broadcast(id, {
      type: "session.updated",
      title: session.title,
      rootFocus: session.rootFocus,
      autoMap: session.autoMap,
    });
    return session;
  }

  ensureSpeaker(
    session: DialogueSession,
    channelOrId: number | string,
    preferredName?: string,
    role?: string,
    options?: { allowRenameExistingSlot?: boolean }
  ): Speaker {
    const cleanPreferred = preferredName?.trim();
    const allowRename = options?.allowRenameExistingSlot ?? false;

    // 1. If a real speaker name is provided (e.g. from an enrolled VoiceSeed or agent),
    // match by existing speaker name FIRST so reordered diarization slots NEVER clobber
    // another speaker's existing ID or history!
    if (cleanPreferred && !isGenericSpeakerName(cleanPreferred) && !allowRename) {
      const byName = session.speakers.find(
        (s) => s.name.toLowerCase() === cleanPreferred.toLowerCase()
      );
      if (byName) {
        if (role !== undefined && byName.role !== role) {
          byName.role = role;
          this.broadcast(session.id, { type: "speaker.updated", speaker: byName });
        }
        return byName;
      }
    }

    let speakerId: string;
    let channel: number;

    if (typeof channelOrId === "number") {
      channel = Math.max(1, channelOrId);
      speakerId = `speaker_${channel}`;
    } else {
      const m = channelOrId.match(/(\d+)$/);
      channel = m ? Math.max(1, Number(m[1])) : session.speakers.length + 1;
      speakerId = channelOrId;
    }

    let existing = session.speakers.find((s) => s.id === speakerId);

    // 2. If this slot is already owned by a DIFFERENT named speaker and we're resolving
    // an incoming turn (not an explicit rename), allocate the next unused channel instead
    // of relabeling the existing speaker!
    if (
      existing &&
      !allowRename &&
      cleanPreferred &&
      !isGenericSpeakerName(cleanPreferred) &&
      !isGenericSpeakerName(existing.name) &&
      existing.name.toLowerCase() !== cleanPreferred.toLowerCase()
    ) {
      const usedChannels = new Set(session.speakers.map((s) => s.channel));
      let nextCh = 1;
      while (usedChannels.has(nextCh)) nextCh++;
      channel = nextCh;
      speakerId = `speaker_${channel}`;
      existing = undefined;
    }

    if (!existing) {
      existing = {
        id: speakerId,
        channel,
        name: cleanPreferred || `Speaker ${channel}`,
        color: SPEAKER_PALETTE[(channel - 1) % SPEAKER_PALETTE.length],
        role,
      };
      session.speakers.push(existing);
      session.speakers.sort((a, b) => a.channel - b.channel);
      this.broadcast(session.id, { type: "speaker.updated", speaker: existing });
    } else {
      let changed = false;
      if (
        cleanPreferred &&
        existing.name !== cleanPreferred &&
        (allowRename || isGenericSpeakerName(existing.name))
      ) {
        existing.name = cleanPreferred;
        changed = true;
      }
      if (role !== undefined && existing.role !== role) {
        existing.role = role;
        changed = true;
      }
      if (changed) {
        this.broadcast(session.id, { type: "speaker.updated", speaker: existing });
      }
    }
    return existing;
  }

  markSpeakerVoiceEnrolled(
    sessionId: string,
    speakerId: string,
    enrolled = true
  ): Speaker | undefined {
    const session = this.sessions.get(sessionId);
    if (!session) return undefined;
    const spk = session.speakers.find((s) => s.id === speakerId);
    if (!spk) return undefined;
    if (spk.voiceEnrolled !== enrolled) {
      spk.voiceEnrolled = enrolled;
      session.updatedAt = nowIso();
      this.persist();
      this.broadcast(session.id, { type: "speaker.updated", speaker: spk });
    }
    return spk;
  }

  renameSpeaker(
    sessionId: string,
    speakerId: string,
    name: string,
    role?: string
  ): Speaker | undefined {
    const session = this.sessions.get(sessionId);
    if (!session) return undefined;
    const speaker = this.ensureSpeaker(session, speakerId, name, role, {
      allowRenameExistingSlot: true,
    });
    session.updatedAt = nowIso();
    this.persist();
    return speaker;
  }

  updateTurn(
    sessionId: string,
    turnId: string,
    patch: {
      speakerId?: string;
      speakerChannel?: number;
      speakerName?: string;
      speakerRole?: string;
      text?: string;
    }
  ): { turn: TranscriptTurn; speaker: Speaker } | undefined {
    const session = this.sessions.get(sessionId);
    if (!session) return undefined;
    const turn = session.turns.find((t) => t.id === turnId);
    if (!turn) return undefined;

    let speaker =
      session.speakers.find((s) => s.id === turn.speakerId) ||
      this.ensureSpeaker(session, turn.speakerId);

    const hasSpeakerChange =
      patch.speakerId !== undefined ||
      patch.speakerChannel !== undefined ||
      Boolean(patch.speakerName?.trim());

    if (hasSpeakerChange) {
      let targetKey: string | number;
      if (patch.speakerId) {
        targetKey = patch.speakerId;
      } else if (patch.speakerChannel) {
        targetKey = patch.speakerChannel;
      } else {
        // Create next available speaker channel for a brand-new named speaker
        const usedChannels = new Set(session.speakers.map((s) => s.channel));
        let nextCh = 1;
        while (usedChannels.has(nextCh)) nextCh++;
        targetKey = nextCh;
      }

      speaker = this.ensureSpeaker(
        session,
        targetKey,
        patch.speakerName,
        patch.speakerRole
      );
      turn.speakerId = speaker.id;

      // Sync speakerIds on any IBIS nodes linked to this turn
      const turnById = new Map(session.turns.map((t) => [t.id, t]));
      const affectedNodeIds: string[] = [];
      for (const node of session.nodes) {
        if (node.turnIds.includes(turn.id)) {
          const derivedSpeakers = Array.from(
            new Set(
              node.turnIds
                .map((tid) => turnById.get(tid)?.speakerId)
                .filter((id): id is string => Boolean(id))
            )
          );
          node.speakerIds = derivedSpeakers;
          node.updatedAt = nowIso();
          affectedNodeIds.push(node.id);
        }
      }

      if (affectedNodeIds.length > 0) {
        this.broadcast(session.id, {
          type: "map.updated",
          nodes: session.nodes,
          crossLinks: session.crossLinks,
          affectedNodeIds,
        });
      }
    }

    if (patch.text !== undefined && patch.text.trim()) {
      turn.text = patch.text.trim();
    }

    session.updatedAt = nowIso();
    this.persist();
    this.broadcast(session.id, { type: "transcript.turn_updated", turn });
    return { turn, speaker };
  }

  appendTurns(
    sessionId: string,
    rawTurns: Array<{
      id?: string;
      speakerId?: string;
      speakerChannel?: number;
      speakerName?: string;
      speakerRole?: string;
      text: string;
      startSec?: number;
      endSec?: number;
      overlap?: boolean;
      overlapWith?: string[];
      words?: TranscriptTurn["words"];
      source: TranscriptTurn["source"];
      mapped?: boolean;
    }>,
    windowContext?: DiarizationWindowContext
  ): TranscriptTurn[] {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);

    const lastEnd =
      session.turns.length > 0
        ? session.turns[session.turns.length - 1].endSec
        : 0;
    let cursor = lastEnd;

    // Two-pass window slot resolution persisted across the entire inference window (S4):
    // 1. Pre-reserve any seeded slots known for this window (even if absent from this batch),
    //    plus resolve all named slots in this batch so reordered diarization slots keep their
    //    stable session speaker IDs and reserve those IDs for the whole window.
    // 2. Resolve unnamed slots using the persistent slot map or allocate an unclaimed speaker ID
    //    so an unenrolled voice in slot 2 never collides with a speaker claimed in slot 1.
    const ctx: DiarizationWindowContext =
      windowContext || createDiarizationWindowContext();
    const slotToSpeakerId = ctx.slotToSpeakerId;
    const claimedIds = ctx.claimedSpeakerIds;

    if (ctx.seedNamesBySlot && !ctx.seedsInitialized) {
      ctx.seedsInitialized = true;
      for (const [slot, seedName] of ctx.seedNamesBySlot.entries()) {
        const cleanSeed = seedName.trim();
        if (!cleanSeed || isGenericSpeakerName(cleanSeed)) continue;
        const existingByName = session.speakers.find(
          (s) => s.name.toLowerCase() === cleanSeed.toLowerCase()
        );
        if (existingByName) {
          slotToSpeakerId.set(slot, existingByName.id);
          claimedIds.add(existingByName.id);
        }
      }
    }

    for (const raw of rawTurns) {
      if (!raw.text.trim()) continue;
      if (raw.speakerId) {
        claimedIds.add(raw.speakerId);
        continue;
      }
      const ch = raw.speakerChannel ?? 1;
      const cleanName = raw.speakerName?.trim();
      if (
        cleanName &&
        !isGenericSpeakerName(cleanName) &&
        !slotToSpeakerId.has(ch)
      ) {
        const spk = this.ensureSpeaker(session, ch, cleanName, raw.speakerRole);
        slotToSpeakerId.set(ch, spk.id);
        claimedIds.add(spk.id);
      }
    }

    const resolveBatchSpeaker = (raw: (typeof rawTurns)[number]): Speaker => {
      if (raw.speakerId) {
        return this.ensureSpeaker(
          session,
          raw.speakerId,
          raw.speakerName,
          raw.speakerRole
        );
      }
      const ch = raw.speakerChannel ?? 1;
      const cachedId = slotToSpeakerId.get(ch);
      if (cachedId) {
        return this.ensureSpeaker(
          session,
          cachedId,
          raw.speakerName,
          raw.speakerRole
        );
      }

      const candidateId = `speaker_${Math.max(1, ch)}`;
      let targetCh = Math.max(1, ch);
      if (claimedIds.has(candidateId)) {
        const usedChannels = new Set(session.speakers.map((s) => s.channel));
        let nextCh = 1;
        while (usedChannels.has(nextCh) || claimedIds.has(`speaker_${nextCh}`)) {
          nextCh++;
        }
        targetCh = nextCh;
      }
      const spk = this.ensureSpeaker(
        session,
        targetCh,
        raw.speakerName,
        raw.speakerRole
      );
      slotToSpeakerId.set(ch, spk.id);
      claimedIds.add(spk.id);
      return spk;
    };

    const added: TranscriptTurn[] = [];
    for (const raw of rawTurns) {
      const cleaned = raw.text.trim();
      if (!cleaned) continue;

      const speaker = resolveBatchSpeaker(raw);
      const resolvedOverlapWith = raw.overlapWith?.map((id) => {
        const m = id.match(/^speaker_(\d+)$/);
        if (m) {
          const mappedId = slotToSpeakerId.get(Number(m[1]));
          if (mappedId) return mappedId;
        }
        return id;
      });

      const startSec = raw.startSec ?? Number((cursor + 0.3).toFixed(2));
      const estDur = Math.max(1.2, cleaned.split(/\s+/).length * 0.38);
      const endSec = raw.endSec ?? Number((startSec + estDur).toFixed(2));
      cursor = Math.max(cursor, endSec);

      const turn: TranscriptTurn = {
        id: raw.id || shortId("trn"),
        speakerId: speaker.id,
        text: cleaned,
        startSec,
        endSec,
        overlap: raw.overlap,
        overlapWith: resolvedOverlapWith,
        words: raw.words,
        source: raw.source,
        createdAt: nowIso(),
        mapped: raw.mapped ?? false,
      };
      session.turns.push(turn);
      added.push(turn);
    }

    if (added.length > 0) {
      session.updatedAt = nowIso();
      this.persist();
      if (added.length === 1) {
        this.broadcast(sessionId, { type: "transcript.turn", turn: added[0] });
      } else {
        this.broadcast(sessionId, {
          type: "transcript.turns_batch",
          turns: added,
        });
      }
    }

    return added;
  }

  applyMapOps(
    sessionId: string,
    batch: IBISOpBatch
  ): { session: DialogueSession; affectedNodeIds: string[]; activity?: MapActivityEntry } {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);

    const now = nowIso();
    const affected = new Set<string>();
    const nodeMap = new Map<string, IBISNode>(session.nodes.map((n) => [n.id, n]));
    let contextChanged = false;
    const newlyMarkedHostTurns = new Set<string>();
    if (!Array.isArray(session.hostContext)) session.hostContext = [];

    const wouldCreateCycle = (nodeId: string, candidateParentId: string | null): boolean => {
      if (!candidateParentId) return false;
      if (candidateParentId === nodeId) return true;
      let cur: string | null = candidateParentId;
      const seen = new Set<string>();
      while (cur) {
        if (cur === nodeId) return true;
        if (seen.has(cur)) return true;
        seen.add(cur);
        cur = nodeMap.get(cur)?.parentId ?? null;
      }
      return false;
    };

    for (const op of batch.ops) {
      switch (op.op) {
        case "add_node": {
          const id = op.id || shortId(op.type[0]);
          const parentId =
            op.parentId && nodeMap.has(op.parentId) ? op.parentId : null;
          const parentNode = parentId ? nodeMap.get(parentId) ?? null : null;

          // If node with same explicit ID exists, treat as update to stay idempotent
          const existing = nodeMap.get(id);
          if (existing) {
            existing.type = op.type;
            existing.label = op.label.trim();
            if (op.detail !== undefined) existing.detail = op.detail;
            if (op.turnIds) {
              existing.turnIds = Array.from(new Set([...existing.turnIds, ...op.turnIds]));
            }
            if (op.speakerIds) {
              existing.speakerIds = Array.from(
                new Set([...existing.speakerIds, ...op.speakerIds])
              );
            }
            existing.updatedAt = now;
            affected.add(existing.id);
            break;
          }

          const node: IBISNode = {
            id,
            type: op.type,
            label: op.label.trim(),
            detail: op.detail?.trim() || undefined,
            parentId,
            relationLabel:
              op.relationLabel || defaultRelationLabel(parentNode?.type ?? null, op.type),
            turnIds: Array.from(new Set(op.turnIds || [])),
            speakerIds: Array.from(new Set(op.speakerIds || [])),
            createdAt: now,
            updatedAt: now,
            createdBy: batch.actor,
          };

          session.nodes.push(node);
          nodeMap.set(node.id, node);
          affected.add(node.id);
          break;
        }

        case "update_node": {
          const node = nodeMap.get(op.id);
          if (!node) break;
          if (op.type) {
            node.type = op.type;
            const parent = node.parentId ? nodeMap.get(node.parentId) ?? null : null;
            if (!op.relationLabel) {
              node.relationLabel = defaultRelationLabel(parent?.type ?? null, op.type);
            }
          }
          if (op.label !== undefined) node.label = op.label.trim();
          if (op.detail !== undefined) node.detail = op.detail.trim() || undefined;
          if (op.relationLabel !== undefined) node.relationLabel = op.relationLabel;
          if (op.addTurnIds?.length) {
            node.turnIds = Array.from(new Set([...node.turnIds, ...op.addTurnIds]));
          }
          if (op.addSpeakerIds?.length) {
            node.speakerIds = Array.from(
              new Set([...node.speakerIds, ...op.addSpeakerIds])
            );
          }
          node.updatedAt = now;
          affected.add(node.id);
          break;
        }

        case "move_node": {
          const node = nodeMap.get(op.id);
          if (!node) break;
          const nextParent =
            op.parentId && nodeMap.has(op.parentId) ? op.parentId : null;
          if (!wouldCreateCycle(node.id, nextParent)) {
            node.parentId = nextParent;
            const parent = nextParent ? nodeMap.get(nextParent) ?? null : null;
            node.relationLabel =
              op.relationLabel || defaultRelationLabel(parent?.type ?? null, node.type);
            node.updatedAt = now;
            affected.add(node.id);
          }
          break;
        }

        case "delete_node": {
          const target = nodeMap.get(op.id);
          if (!target) break;
          const toRemove = new Set<string>([op.id]);
          if (op.cascade !== false) {
            let expanded = true;
            while (expanded) {
              expanded = false;
              for (const n of session.nodes) {
                if (n.parentId && toRemove.has(n.parentId) && !toRemove.has(n.id)) {
                  toRemove.add(n.id);
                  expanded = true;
                }
              }
            }
          } else {
            // Re-parent direct children to deleted node's parent
            for (const n of session.nodes) {
              if (n.parentId === op.id) {
                n.parentId = target.parentId;
                n.updatedAt = now;
                affected.add(n.id);
              }
            }
          }

          session.nodes = session.nodes.filter((n) => !toRemove.has(n.id));
          for (const rem of toRemove) nodeMap.delete(rem);
          session.crossLinks = session.crossLinks.filter(
            (l) => !toRemove.has(l.fromId) && !toRemove.has(l.toId)
          );
          break;
        }

        case "add_cross_link": {
          if (
            op.fromId === op.toId ||
            !nodeMap.has(op.fromId) ||
            !nodeMap.has(op.toId)
          ) {
            break;
          }
          const dup = session.crossLinks.find(
            (l) =>
              l.fromId === op.fromId && l.toId === op.toId && l.kind === op.kind
          );
          if (!dup) {
            session.crossLinks.push({
              id: op.id || shortId("xl"),
              fromId: op.fromId,
              toId: op.toId,
              kind: op.kind,
              label: op.label,
            });
            affected.add(op.fromId);
            affected.add(op.toId);
          }
          break;
        }

        case "remove_cross_link": {
          session.crossLinks = session.crossLinks.filter((l) => l.id !== op.id);
          break;
        }

        case "rename_speaker": {
          this.ensureSpeaker(session, op.speakerId, op.name, op.role, {
            allowRenameExistingSlot: true,
          });
          break;
        }

        case "set_title": {
          session.title = op.title.trim();
          if (op.rootFocus !== undefined) session.rootFocus = op.rootFocus;
          this.broadcast(sessionId, {
            type: "session.updated",
            title: session.title,
            rootFocus: session.rootFocus,
            autoMap: session.autoMap,
          });
          break;
        }

        case "add_host_context": {
          const id = op.id || shortId("hc");
          const existing = session.hostContext.find((c) => c.id === id);
          const turnIds = Array.from(new Set(op.turnIds || []));
          const speakerIds = Array.from(new Set(op.speakerIds || []));
          if (existing) {
            existing.category = op.category;
            existing.summary = op.summary.trim();
            existing.turnIds = Array.from(new Set([...existing.turnIds, ...turnIds]));
            existing.speakerIds = Array.from(
              new Set([...existing.speakerIds, ...speakerIds])
            );
          } else {
            session.hostContext.push({
              id,
              category: op.category,
              summary: op.summary.trim(),
              turnIds,
              speakerIds,
              createdAt: now,
            });
          }
          for (const tid of turnIds) {
            const trn = session.turns.find((t) => t.id === tid);
            if (trn) {
              trn.kind = "host_context";
              newlyMarkedHostTurns.add(trn.id);
            }
          }
          contextChanged = true;
          break;
        }

        case "remove_host_context": {
          const before = session.hostContext.length;
          session.hostContext = session.hostContext.filter((c) => c.id !== op.id);
          if (session.hostContext.length !== before) {
            contextChanged = true;
          }
          break;
        }
      }
    }

    if (batch.markTurnIdsMapped?.length) {
      const mappedSet = new Set(batch.markTurnIdsMapped);
      for (const turn of session.turns) {
        if (mappedSet.has(turn.id)) {
          turn.mapped = true;
        }
      }
    }

    let activity: MapActivityEntry | undefined;
    if (batch.summary || affected.size > 0) {
      activity = {
        id: shortId("act"),
        timestamp: now,
        actor: batch.actor,
        summary:
          batch.summary ||
          `Applied ${batch.ops.length} dialogue map update${batch.ops.length === 1 ? "" : "s"}`,
        affectedNodeIds: Array.from(affected),
      };
      session.activity.push(activity);
      if (session.activity.length > 80) {
        session.activity = session.activity.slice(-80);
      }
    }

    session.updatedAt = now;
    this.persist();

    this.broadcast(sessionId, {
      type: "map.updated",
      nodes: session.nodes,
      crossLinks: session.crossLinks,
      affectedNodeIds: Array.from(affected),
      activity,
    });

    if (contextChanged) {
      this.broadcast(sessionId, {
        type: "session.context_updated",
        hostContext: session.hostContext,
        hostTurnIds: Array.from(newlyMarkedHostTurns),
      });
    }

    return { session, affectedNodeIds: Array.from(affected), activity };
  }

  resetMap(sessionId: string): DialogueSession | undefined {
    const session = this.sessions.get(sessionId);
    if (!session) return undefined;
    this.bumpGeneration(sessionId);
    session.nodes = [];
    session.crossLinks = [];
    for (const t of session.turns) {
      t.mapped = false;
    }
    session.updatedAt = nowIso();
    this.persist();
    this.broadcast(sessionId, {
      type: "map.updated",
      nodes: [],
      crossLinks: [],
      affectedNodeIds: [],
    });
    return session;
  }
}

export const sessionStore = new SessionStore();
