import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type IBISNode, type TranscriptTurn } from "../shared/schemas/models";
import { computeConklinStats } from "../shared/ibis";
import { alignWordsToDiarization, wordsToDiarizedTurns } from "../server/lib/speech";
import { createDiarizationWindowContext, SessionStore } from "../server/lib/store";
import { DialogueMapperEngine } from "../server/lib/mapper";
import { isValidYouTubeUrl, parseDownloadProgress } from "../server/lib/youtube";
import { AppendTurnsRequestSchema, IBISOpBatchSchema } from "../shared/schemas/contracts";
import "../shared/schemas/events";
import { toOpenApiComponents } from "../shared/schemas/registry";

let testDataDir: string;

beforeAll(() => {
  testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "dialogger-test-"));
});

afterAll(() => {
  if (testDataDir && fs.existsSync(testDataDir)) {
    fs.rmSync(testDataDir, { recursive: true, force: true });
  }
});

function createIsolatedStore(): SessionStore {
  const dir = fs.mkdtempSync(path.join(testDataDir, "store-"));
  return new SessionStore(dir);
}

describe("wordsToDiarizedTurns", () => {
  it("groups consecutive speaker words and detects overlapping speech", () => {
    const turns = wordsToDiarizedTurns([
      { word: "How", start: 0.1, end: 0.3, speaker: 1 },
      { word: "should", start: 0.3, end: 0.6, speaker: 1 },
      { word: "we", start: 0.6, end: 0.8, speaker: 1 },
      { word: "deploy?", start: 0.8, end: 1.5, speaker: 1 },
      // Speaker 2 jumps in while Speaker 1 is finishing (0.4s overlap)
      { word: "Local", start: 1.1, end: 1.4, speaker: 2 },
      { word: "first!", start: 1.4, end: 1.9, speaker: 2 },
    ]);

    expect(turns).toHaveLength(2);
    expect(turns[0].speakerChannel).toBe(1);
    expect(turns[0].text).toBe("How should we deploy?");
    expect(turns[1].speakerChannel).toBe(2);
    expect(turns[1].text).toBe("Local first!");
    expect(turns[0].overlap).toBe(true);
    expect(turns[0].overlapWithChannels).toContain(2);
    expect(turns[1].overlap).toBe(true);
    expect(turns[1].overlapWithChannels).toContain(1);
  });

  it("splits turns across long pauses even for the same speaker", () => {
    const turns = wordsToDiarizedTurns([
      { word: "First", start: 0.0, end: 0.4, speaker: 1 },
      { word: "thought.", start: 0.4, end: 0.9, speaker: 1 },
      { word: "Second", start: 4.5, end: 4.9, speaker: 1 },
      { word: "thought.", start: 4.9, end: 5.4, speaker: 1 },
    ]);

    expect(turns).toHaveLength(2);
    expect(turns[0].text).toBe("First thought.");
    expect(turns[1].text).toBe("Second thought.");
  });
});

describe("computeConklinStats", () => {
  it("identifies open questions, resolved questions, contested ideas, and nudges", () => {
    const now = new Date().toISOString();
    const base = {
      turnIds: [],
      speakerIds: ["speaker_1"],
      createdAt: now,
      updatedAt: now,
      createdBy: "model" as const,
    };

    const nodes: IBISNode[] = [
      { id: "q1", type: "question", label: "Which ASR model?", parentId: null, ...base },
      { id: "i1", type: "idea", label: "Use Parakeet TDT v3", parentId: "q1", ...base },
      { id: "p1", type: "pro", label: "High multilingual accuracy", parentId: "i1", ...base },
      { id: "c1", type: "con", label: "Offline only", parentId: "i1", ...base },
      { id: "q2", type: "question", label: "Which diarizer?", parentId: null, ...base },
      { id: "i2", type: "idea", label: "Use Nemotron 3 Diarization", parentId: "q2", ...base },
      { id: "d1", type: "decision", label: "Adopt Nemotron 3 Diarization", parentId: "i2", ...base },
    ];

    const turns: TranscriptTurn[] = [
      {
        id: "t1",
        speakerId: "speaker_1",
        text: "Test",
        startSec: 0,
        endSec: 1,
        overlap: true,
        source: "file",
        createdAt: now,
        mapped: true,
      },
    ];

    const stats = computeConklinStats(nodes, turns);
    expect(stats.openQuestionIds).toEqual(["q1"]);
    expect(stats.resolvedQuestionIds).toEqual(["q2"]);
    expect(stats.contestedIdeaIds).toEqual(["i1"]);
    expect(stats.overlappingTurns).toBe(1);
    expect(stats.counts.decision).toBe(1);
  });
});

describe("SessionStore & Heuristic Conklin Mapper", () => {
  it("prevents parent cycles and cascades deletes cleanly", () => {
    const store = createIsolatedStore();
    const session = store.createSession({ title: "Cycle test" });

    store.applyMapOps(session.id, {
      actor: "agent",
      ops: [
        { op: "add_node", id: "q1", type: "question", label: "Root?", parentId: null },
        { op: "add_node", id: "i1", type: "idea", label: "Idea 1", parentId: "q1" },
        { op: "add_node", id: "p1", type: "pro", label: "Pro 1", parentId: "i1" },
        // Illegal cycle attempt: moving q1 under its own descendant p1
        { op: "move_node", id: "q1", parentId: "p1" },
      ],
    });

    const afterMove = store.getSession(session.id)!;
    expect(afterMove.nodes.find((n) => n.id === "q1")?.parentId).toBeNull();

    store.applyMapOps(session.id, {
      actor: "agent",
      ops: [{ op: "delete_node", id: "i1", cascade: true }],
    });
    expect(store.getSession(session.id)!.nodes.map((n) => n.id)).toEqual(["q1"]);
  });

  it("surfaces implicit question before attaching an orphan idea and detects speaker names", () => {
    const store = createIsolatedStore();
    const mapper = new DialogueMapperEngine();
    const session = store.createSession({ title: "Database Migration" });
    const turns = store.appendTurns(session.id, [
      {
        speakerChannel: 1,
        text: "I'm Maya. We should run local Nemotron 3 Diarization for privacy.",
        source: "agent",
      },
      {
        speakerChannel: 2,
        text: "My concern is CPU usage on older laptops.",
        source: "agent",
      },
      {
        speakerChannel: 1,
        text: "Agreed, let's go with Q8_0 local inference.",
        source: "agent",
      },
    ]);

    const batch = mapper.runHeuristicMapper(session, turns);
    store.applyMapOps(session.id, batch);

    const updated = store.getSession(session.id)!;
    expect(updated.speakers.find((s) => s.id === "speaker_1")?.name).toBe("Maya");
    expect(updated.nodes.some((n) => n.type === "question")).toBe(true);
    expect(updated.nodes.some((n) => n.type === "idea")).toBe(true);
    expect(updated.nodes.some((n) => n.type === "con")).toBe(true);
    expect(updated.nodes.some((n) => n.type === "decision")).toBe(true);
  });

  it("emits add_host_context in heuristic mode for moderator format/rules and skips sponsor reads (S6)", () => {
    const store = createIsolatedStore();
    const mapper = new DialogueMapperEngine();
    const session = store.createSession({ title: "Debate Heuristic Host Context" });
    const turns = store.appendTurns(session.id, [
      {
        speakerChannel: 1,
        text: "Use promo code LUTHER to save 20% with our sponsor today.",
        source: "file",
      },
      {
        speakerChannel: 1,
        text: "Let me lay out the debate format: each speaker gets 8-minute opening statements and 5-minute rebuttals.",
        source: "file",
      },
      {
        speakerChannel: 1,
        text: "Please respect the ground rules and hold applause until the end.",
        source: "file",
      },
      {
        speakerChannel: 2,
        text: "Should churches adopt contemporary worship music?",
        source: "file",
      },
    ]);

    const batch = mapper.runHeuristicMapper(session, turns);
    store.applyMapOps(session.id, batch);

    const updated = store.getSession(session.id)!;
    expect(updated.hostContext).toHaveLength(2);
    expect(updated.hostContext.map((h) => h.category)).toEqual([
      "format",
      "ground_rules",
    ]);
    // Only the substantive question should land on the IBIS map — not the sponsor read or format rules
    expect(updated.nodes).toHaveLength(1);
    expect(updated.nodes[0].type).toBe("question");
  });

  it("resolves reordered voice-seed slots to stable speaker IDs without renaming existing speakers (S4)", () => {
    const store = createIsolatedStore();
    const session = store.createSession({ title: "Stable Speaker ID Test" });

    // Window 1: Moderator is speaker_1, Alice is speaker_2
    const [t1, t2] = store.appendTurns(session.id, [
      { speakerChannel: 1, speakerName: "Moderator", text: "Welcome everyone.", source: "file" },
      { speakerChannel: 2, speakerName: "Alice", text: "Thanks for having me.", source: "file" },
    ]);
    expect(t1.speakerId).toBe("speaker_1");
    expect(t2.speakerId).toBe("speaker_2");

    // Window 2: Voice seeds reorder so Alice arrives in slot 1 and an unnamed voice arrives in slot 2
    const [t3, t4] = store.appendTurns(session.id, [
      { speakerChannel: 1, speakerName: "Alice", text: "Here is my argument.", source: "file" },
      { speakerChannel: 2, text: "I have a follow-up question.", source: "file" },
    ]);

    const updated = store.getSession(session.id)!;
    // Alice MUST keep her stable speaker_2 ID, and Moderator (speaker_1) MUST NOT be renamed!
    expect(t3.speakerId).toBe("speaker_2");
    expect(updated.speakers.find((s) => s.id === "speaker_1")?.name).toBe("Moderator");
    expect(updated.speakers.find((s) => s.id === "speaker_2")?.name).toBe("Alice");
    // The unnamed slot 2 voice in window 2 must NOT collide with Alice (speaker_2)
    expect(t4.speakerId).toBe("speaker_3");
  });

  it("persists slot-to-session identity across multiple streaming batches in one diarization window (R2 S4)", () => {
    const store = createIsolatedStore();
    const session = store.createSession({ title: "Multi-batch Window Slot Test" });

    // Existing speakers: Alice = speaker_1, Bob = speaker_2
    store.appendTurns(session.id, [
      { speakerChannel: 1, speakerName: "Alice", text: "Hi, I'm Alice.", source: "file" },
      { speakerChannel: 2, speakerName: "Bob", text: "Hi, I'm Bob.", source: "file" },
    ]);

    // Next diarization window has Bob seeded in slot 1
    const winCtx = createDiarizationWindowContext(new Map([[1, "Bob"]]));

    // Batch 1: Bob speaks in slot 1
    const [b1] = store.appendTurns(
      session.id,
      [{ speakerChannel: 1, speakerName: "Bob", text: "First batch from Bob.", source: "file" }],
      winCtx
    );
    expect(b1.speakerId).toBe("speaker_2");

    // Batch 2 (same window, Bob absent): unknown speaker speaks in slot 2
    const [b2] = store.appendTurns(
      session.id,
      [{ speakerChannel: 2, text: "Unknown voice in slot 2.", source: "file" }],
      winCtx
    );
    expect(b2.speakerId).toBe("speaker_3");

    // Batch 3 (same window): same unknown voice in slot 2 keeps speaker_3
    const [b3] = store.appendTurns(
      session.id,
      [{ speakerChannel: 2, text: "Continuing unknown voice.", source: "file" }],
      winCtx
    );
    expect(b3.speakerId).toBe("speaker_3");
  });

  it("reassigns a turn speaker and updates linked IBIS node speakerIds", () => {
    const store = createIsolatedStore();
    const session = store.createSession({ title: "Speaker reassign test" });
    const [turn] = store.appendTurns(session.id, [
      { speakerChannel: 1, text: "How should we worship?", source: "file" },
    ]);
    store.applyMapOps(session.id, {
      actor: "model",
      ops: [
        {
          op: "add_node",
          id: "q1",
          type: "question",
          label: "How should we worship?",
          parentId: null,
          turnIds: [turn.id],
          speakerIds: [turn.speakerId],
        },
      ],
    });

    const res = store.updateTurn(session.id, turn.id, {
      speakerName: "Pastor Wolfmiller",
    });
    expect(res?.speaker.name).toBe("Pastor Wolfmiller");
    const updated = store.getSession(session.id)!;
    expect(updated.turns[0].speakerId).toBe(res?.speaker.id);
    expect(updated.nodes[0].speakerIds).toEqual([res?.speaker.id]);
  });

  it("clips boundary turn words and rebuilds text when trimming audio without clearing (S10)", () => {
    const store = createIsolatedStore();
    const session = store.createSession({ title: "Trim Boundary Clip Test" });
    store.setSessionAudio(session.id, {
      filename: "fake.mp3",
      mimeType: "audio/mpeg",
      durationSec: 300,
    });
    const [introTurn, crossTurn] = store.appendTurns(session.id, [
      {
        speakerChannel: 1,
        text: "Check out our sponsor today!",
        startSec: 5,
        endSec: 25,
        source: "file",
      },
      {
        speakerChannel: 1,
        text: "Skip this intro. Each speaker gets eight minutes.",
        startSec: 58,
        endSec: 68,
        words: [
          { word: "Skip", start: 58.0, end: 58.5, speaker: 1 },
          { word: "this", start: 58.6, end: 59.0, speaker: 1 },
          { word: "intro.", start: 59.1, end: 59.7, speaker: 1 },
          { word: "Each", start: 60.5, end: 61.0, speaker: 1 },
          { word: "speaker", start: 61.1, end: 61.8, speaker: 1 },
          { word: "gets", start: 61.9, end: 62.3, speaker: 1 },
          { word: "eight", start: 62.4, end: 62.9, speaker: 1 },
          { word: "minutes.", start: 63.0, end: 63.8, speaker: 1 },
          { word: "Trailing", start: 299.0, end: 302.0, speaker: 1 },
        ],
        source: "file",
      },
    ]);

    store.applyMapOps(session.id, {
      actor: "model",
      ops: [
        {
          op: "add_host_context",
          id: "hc-fmt",
          category: "format",
          summary: "8-minute opening statements",
          turnIds: [crossTurn.id],
          speakerIds: [crossTurn.speakerId],
        },
        {
          op: "add_host_context",
          id: "hc-manual",
          category: "background",
          summary: "Manual context entered by host",
          turnIds: [],
          speakerIds: [],
        },
      ],
    });

    // Trim to [60, 200] (newDuration = 140s)
    store.applyAudioTrimState(session.id, {
      startSec: 60,
      endSec: 200,
      newDurationSec: 140,
      clearTranscriptAndMap: false,
    });

    const cur = store.getSession(session.id)!;
    expect(cur.turns).toHaveLength(1);
    expect(cur.turns[0].id).toBe(crossTurn.id);
    expect(cur.turns[0].text).toBe("Each speaker gets eight minutes.");
    expect(cur.turns[0].startSec).toBe(0.5);
    expect(cur.turns[0].endSec).toBe(3.8);
    expect(cur.turns[0].words?.every((w) => w.start >= 0 && w.end <= 140)).toBe(true);
    expect(cur.turns.find((t) => t.id === introTurn.id)).toBeUndefined();
    expect(cur.audio?.durationSec).toBe(140);

    // clearForFreshRun with preserveManualHostContext keeps manual context (S7)
    store.clearForFreshRun(session.id, true);
    const cleared = store.getSession(session.id)!;
    expect(cleared.turns).toHaveLength(0);
    expect(cleared.hostContext.map((h) => h.id)).toEqual(["hc-manual"]);
  });

  it("drops automatic hostContext whose turns are all trimmed away while keeping manual hostContext (R2 S8)", () => {
    const store = createIsolatedStore();
    const session = store.createSession({ title: "Trim Host Context Provenance Test" });
    store.setSessionAudio(session.id, {
      filename: "fake.mp3",
      mimeType: "audio/mpeg",
      durationSec: 200,
    });
    const [earlyTurn, lateTurn] = store.appendTurns(session.id, [
      { speakerChannel: 1, text: "Debate rules intro", startSec: 5, endSec: 15, source: "file" },
      { speakerChannel: 2, text: "Main argument later", startSec: 80, endSec: 95, source: "file" },
    ]);
    store.applyMapOps(session.id, {
      actor: "model",
      ops: [
        {
          op: "add_host_context",
          id: "hc-auto",
          category: "format",
          summary: "Extracted from early intro turn",
          turnIds: [earlyTurn.id],
          speakerIds: [earlyTurn.speakerId],
        },
        {
          op: "add_host_context",
          id: "hc-manual",
          category: "background",
          summary: "Manual host note",
          turnIds: [],
          speakerIds: [],
        },
      ],
    });

    // Non-clearing trim past 30s removes earlyTurn
    store.applyAudioTrimState(session.id, {
      startSec: 30,
      newDurationSec: 170,
      clearTranscriptAndMap: false,
    });
    const afterTrim = store.getSession(session.id)!;
    expect(afterTrim.turns.map((t) => t.id)).toEqual([lateTurn.id]);
    // hc-auto lost its only source turn -> MUST be dropped, NOT kept with empty turnIds!
    expect(afterTrim.hostContext.map((h) => h.id)).toEqual(["hc-manual"]);
  });

  it("clips boundary turns at exact playhead and prunes derived map nodes when truncating (R2 S7)", () => {
    const store = createIsolatedStore();
    const session = store.createSession({ title: "Playhead Truncate Test" });
    const [boundaryTurn, midTurn, lateTurn] = store.appendTurns(session.id, [
      {
        speakerChannel: 1,
        text: "First half stays. Second half replaced.",
        startSec: 0,
        endSec: 20,
        words: [
          { word: "First", start: 1.0, end: 2.0, speaker: 1 },
          { word: "half", start: 2.1, end: 3.0, speaker: 1 },
          { word: "stays.", start: 3.1, end: 4.0, speaker: 1 },
          { word: "Second", start: 12.0, end: 13.0, speaker: 1 },
          { word: "half", start: 13.1, end: 14.0, speaker: 1 },
          { word: "replaced.", start: 14.1, end: 16.0, speaker: 1 },
        ],
        source: "file",
      },
      { speakerChannel: 2, text: "Old mid point", startSec: 45, endSec: 52, source: "file" },
      { speakerChannel: 1, text: "Old late point", startSec: 90, endSec: 98, source: "file" },
    ]);

    store.applyMapOps(session.id, {
      actor: "model",
      ops: [
        {
          op: "add_node",
          id: "q-mid",
          type: "question",
          label: "Derived from replaced turns",
          parentId: null,
          turnIds: [midTurn.id, lateTurn.id],
          speakerIds: [midTurn.speakerId],
        },
        {
          op: "add_node",
          id: "q-manual",
          type: "question",
          label: "Manual root question",
          parentId: null,
          turnIds: [],
          speakerIds: [],
        },
      ],
    });

    const updated = store.truncateTurnsFrom(session.id, 10)!;
    expect(updated.turns).toHaveLength(1);
    expect(updated.turns[0].id).toBe(boundaryTurn.id);
    expect(updated.turns[0].text).toBe("First half stays.");
    expect(updated.turns[0].endSec).toBe(4.0);
    expect(updated.nodes.map((n) => n.id)).toEqual(["q-manual"]);
  });
});

describe("DialogueMapperEngine credential binding (S1)", () => {
  it("clears stored API key when destination host changes or uses a spoofed prefix", () => {
    const mapper = new DialogueMapperEngine();
    mapper.updateConfig({
      mode: "llm",
      provider: "openai-compatible",
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-4.1-mini",
      apiKey: "sk-test-secret-bound-to-openai",
    });
    expect(mapper.getPublicConfig().hasApiKey).toBe(true);

    // Switching destination to an attacker host (even with a prefix trick!) must clear the key
    mapper.updateConfig({
      baseUrl: "https://api.openai.com.attacker.invalid/v1",
    });
    expect(mapper.getPublicConfig().hasApiKey).toBe(false);
  });
});

describe("YouTube URL validation", () => {
  it("accepts public youtube watch, shorts, live, and youtu.be URLs and rejects others", () => {
    expect(isValidYouTubeUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe(true);
    expect(isValidYouTubeUrl("https://youtu.be/dQw4w9WgXcQ?t=42")).toBe(true);
    expect(isValidYouTubeUrl("https://m.youtube.com/shorts/abc123")).toBe(true);
    expect(isValidYouTubeUrl("https://example.com/video.mp4")).toBe(false);
    expect(isValidYouTubeUrl("file:///etc/passwd")).toBe(false);
  });
});

describe("alignWordsToDiarization", () => {
  it("aligns streamed ASR words to global Nemotron 3 Diarization segments by max overlap", () => {
    const segments = [
      { start: 0.0, end: 5.0, speaker: 1 },
      { start: 5.1, end: 10.0, speaker: 2 },
    ];
    const words = [
      { word: "First", start: 0.5, end: 1.0, speaker: 1 },
      { word: "speaker", start: 1.1, end: 1.8, speaker: 1 },
      { word: "Second", start: 5.2, end: 5.8, speaker: 1 }, // intentionally wrong raw slot
      { word: "speaker", start: 5.9, end: 6.4, speaker: 1 },
    ];
    const aligned = alignWordsToDiarization(words, segments);
    expect(aligned.map((w) => w.speaker)).toEqual([1, 1, 2, 2]);
  });
});

describe("YouTube download progress parsing", () => {
  it("reads byte progress from the yt-dlp progress template", () => {
    expect(parseDownloadProgress("DLPROG 4889046 19556184 NA", 0)).toBeCloseTo(0.25);
    expect(parseDownloadProgress("DLPROG 500 NA 1000", 0)).toBeCloseTo(0.5);
    expect(parseDownloadProgress("DLPROG 500 NA NA", 0)).toBeNull();
  });

  it("reads ffmpeg time= progress for clipped section downloads", () => {
    const line = "size=     512KiB time=00:00:30.00 bitrate= 135.5kbits/s speed=1.71x";
    expect(parseDownloadProgress(line, 60)).toBeCloseTo(0.5);
    expect(parseDownloadProgress(line, 0)).toBeNull();
    expect(parseDownloadProgress("size= 1KiB time=00:01:30.00", 60)).toBe(1);
  });

  it("ignores unrelated output", () => {
    expect(parseDownloadProgress("[youtube] abc: Downloading webpage", 60)).toBeNull();
  });
});

describe("OpenAPI schemas", () => {
  const components = toOpenApiComponents();

  function routeFiles(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name);
      return entry.isDirectory() ? routeFiles(full) : full.endsWith(".ts") ? [full] : [];
    });
  }

  it("resolves every $ref used in route metadata to a shared Zod schema", () => {
    const serverDir = path.resolve(import.meta.dirname, "../server");
    const files = [...routeFiles(path.join(serverDir, "api")), ...routeFiles(path.join(serverDir, "routes"))];
    const refs = new Set<string>();
    for (const file of files) {
      for (const m of fs.readFileSync(file, "utf8").matchAll(/#\/components\/schemas\/(\w+)/g)) {
        refs.add(m[1]);
      }
    }
    expect(refs.size).toBeGreaterThan(20);
    const missing = [...refs].filter((name) => !(name in components));
    expect(missing).toEqual([]);
  });

  it("emits internal refs only to components that exist", () => {
    const text = JSON.stringify(components);
    const missing = [...text.matchAll(/#\/components\/schemas\/(\w+)/g)]
      .map((m) => m[1])
      .filter((name) => !(name in components));
    expect(missing).toEqual([]);
  });

  it("documents map ops as a discriminated union of every op", () => {
    const op = components.IBISMapOp as { oneOf?: Array<{ properties: { op: { const: string } } }> };
    expect(op.oneOf?.map((v) => v.properties.op.const)).toContain("add_node");
    expect(op.oneOf?.length).toBe(10);
  });

  it("normalizes null fields from agents and applies defaults", () => {
    const batch = IBISOpBatchSchema.parse({
      ops: [{ op: "add_node", type: "question", label: "Why?", detail: null, parentId: null }],
    });
    expect(batch.actor).toBe("agent");
    expect(batch.ops[0]).not.toHaveProperty("detail", null);

    const turns = AppendTurnsRequestSchema.parse({ turn: { text: "hi" } });
    expect(turns.turn?.source).toBe("agent");
  });
});
