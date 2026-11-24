import { execFile, spawn, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import type { WordTiming } from "../../shared/schemas/models";
import type { SpeechEngineStatus } from "../../shared/schemas/events";
import {
  readPcm16FromWav,
  voiceBank,
  writePcm16Wav,
  type VoiceSeed,
} from "./voicebank";

const execFileAsync = promisify(execFile);

const NEMO_BIN = process.env.NEMO_SPEECH_BIN || "nemo-speech";
const NEMO_HOST = process.env.NEMO_SPEECH_HOST || "127.0.0.1";
const NEMO_PORT = Number(process.env.NEMO_SPEECH_PORT || 8788);
const DEFAULT_STREAMING_ASR =
  process.env.NEMO_SPEECH_STREAMING_ASR || "nemotron-3.5";
const DEFAULT_OFFLINE_ASR =
  process.env.NEMO_SPEECH_OFFLINE_ASR || "parakeet-tdt";
const DEFAULT_DIAR_MODEL =
  process.env.NEMO_SPEECH_DIAR_MODEL || "nemotron-3-diarization";

export interface DiarizationSegment {
  start: number;
  end: number;
  speaker: number; // 1-based speaker slot
}

export interface DiarizedTurnDraft {
  speakerChannel: number;
  speakerName?: string;
  text: string;
  startSec: number;
  endSec: number;
  overlap: boolean;
  overlapWithChannels: number[];
  words: WordTiming[];
}

/**
 * Aligns word-level ASR timestamps against global continuous Nemotron 3 Diarization
 * segments by maximum temporal overlap (falling back to nearest segment within 0.8s).
 */
export function alignWordsToDiarization(
  words: WordTiming[],
  segments: DiarizationSegment[]
): WordTiming[] {
  if (!segments.length) return words;

  return words.map((w) => {
    let bestSpeaker = w.speaker ?? 1;
    let bestOverlap = 0;

    for (const seg of segments) {
      if (seg.end < w.start) continue;
      if (seg.start > w.end) break;
      const ov = Math.min(w.end, seg.end) - Math.max(w.start, seg.start);
      if (ov > bestOverlap) {
        bestOverlap = ov;
        bestSpeaker = seg.speaker;
      }
    }

    if (bestOverlap <= 0) {
      const mid = (w.start + w.end) / 2;
      let minDist = 0.85;
      for (const seg of segments) {
        const dist =
          mid < seg.start
            ? seg.start - mid
            : mid > seg.end
              ? mid - seg.end
              : 0;
        if (dist < minDist) {
          minDist = dist;
          bestSpeaker = seg.speaker;
        }
      }
    }

    return { ...w, speaker: bestSpeaker };
  });
}

export interface FileTranscriptionResult {
  text: string;
  duration: number;
  asrModel: string;
  diarizationModel: string;
  turns: DiarizedTurnDraft[];
  words: WordTiming[];
  slotNames: Map<number, string>;
}

/**
 * Groups word-level timestamps with 1-based speaker IDs (from NVIDIA Nemotron 3
 * Diarization + Parakeet TDT / Nemotron 3.5 ASR) into clean speaker turns,
 * explicitly detecting overlapping crosstalk across speakers.
 */
export function wordsToDiarizedTurns(
  words: WordTiming[],
  pauseThresholdSec = 2.2
): DiarizedTurnDraft[] {
  if (!words.length) return [];

  // Sort chronologically while preserving order for identical starts
  const sorted = [...words].sort((a, b) => a.start - b.start);

  // Build per-speaker raw turns, splitting on speaker change or long pause
  const turns: DiarizedTurnDraft[] = [];
  let current: DiarizedTurnDraft | null = null;

  for (const w of sorted) {
    const speaker = typeof w.speaker === "number" && w.speaker > 0 ? w.speaker : 1;
    const token = w.word.trim();
    if (!token) continue;

    const shouldSplit =
      !current ||
      current.speakerChannel !== speaker ||
      w.start - current.endSec > pauseThresholdSec;

    if (shouldSplit) {
      if (current) {
        current.text = current.text.trim();
        turns.push(current);
      }
      current = {
        speakerChannel: speaker,
        text: token,
        startSec: Number(w.start.toFixed(2)),
        endSec: Number(w.end.toFixed(2)),
        overlap: false,
        overlapWithChannels: [],
        words: [{ ...w, speaker }],
      };
    } else if (current) {
      // Attach punctuation cleanly without stray spaces
      const sep = /^[,.;:!?)]/.test(token) ? "" : " ";
      current.text += sep + token;
      current.endSec = Number(Math.max(current.endSec, w.end).toFixed(2));
      current.words.push({ ...w, speaker });
    }
  }

  if (current) {
    current.text = current.text.trim();
    turns.push(current);
  }

  // Detect overlapping turns across distinct speakers (e.g. crosstalk captured by Nemotron 3 Diarization)
  for (let i = 0; i < turns.length; i++) {
    const a = turns[i];
    for (let j = i + 1; j < turns.length; j++) {
      const b = turns[j];
      if (b.startSec >= a.endSec) break;
      if (a.speakerChannel !== b.speakerChannel) {
        const overlapAmount = Math.min(a.endSec, b.endSec) - Math.max(a.startSec, b.startSec);
        if (overlapAmount > 0.15) {
          a.overlap = true;
          b.overlap = true;
          if (!a.overlapWithChannels.includes(b.speakerChannel)) {
            a.overlapWithChannels.push(b.speakerChannel);
          }
          if (!b.overlapWithChannels.includes(a.speakerChannel)) {
            b.overlapWithChannels.push(a.speakerChannel);
          }
        }
      }
    }
  }

  return turns;
}

class LocalSpeechEngine {
  private serverProc: ChildProcess | null = null;
  private startingPromise: Promise<void> | null = null;
  private activeStreamingAsr = DEFAULT_STREAMING_ASR;
  private activeDiarModel = DEFAULT_DIAR_MODEL;

  constructor() {
    const cleanup = () => {
      if (this.serverProc && !this.serverProc.killed) {
        this.serverProc.kill("SIGTERM");
      }
    };
    process.once("SIGINT", cleanup);
    process.once("SIGTERM", cleanup);
    process.once("exit", cleanup);
  }

  get serverHttpUrl(): string {
    return `http://${NEMO_HOST}:${NEMO_PORT}`;
  }

  get serverWsUrl(): string {
    return `ws://${NEMO_HOST}:${NEMO_PORT}/v1/audio/transcriptions/realtime`;
  }

  private getModelCacheDir(): string {
    if (process.env.NEMO_SPEECH_MODEL_DIR) return process.env.NEMO_SPEECH_MODEL_DIR;
    if (process.platform === "darwin") {
      return path.join(os.homedir(), "Library", "Caches", "NeMoSpeech", "models");
    }
    const xdg = process.env.XDG_CACHE_HOME || path.join(os.homedir(), ".cache");
    return path.join(xdg, "nemo-speech", "models");
  }

  private isRepoCached(repo: string): boolean {
    const dir = path.join(this.getModelCacheDir(), ...repo.split("/"));
    try {
      if (!fs.existsSync(dir)) return false;
      const walk = (d: string): boolean => {
        for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
          const full = path.join(d, entry.name);
          if (entry.isDirectory() && walk(full)) return true;
          if (entry.isFile() && entry.name.endsWith(".gguf")) return true;
        }
        return false;
      };
      return walk(dir);
    } catch {
      return false;
    }
  }

  async resolveBinary(): Promise<{ path: string; version: string } | null> {
    try {
      const { stdout } = await execFileAsync(NEMO_BIN, ["--version"], {
        timeout: 5000,
      });
      const version = stdout.trim().split("\n")[0] || "unknown";
      let binPath = NEMO_BIN;
      try {
        const whichOut = await execFileAsync("which", [NEMO_BIN], { timeout: 3000 });
        binPath = whichOut.stdout.trim() || NEMO_BIN;
      } catch {
        // ignore
      }
      return { path: binPath, version };
    } catch {
      return null;
    }
  }

  async hasFfmpeg(): Promise<boolean> {
    try {
      await execFileAsync("ffmpeg", ["-version"], { timeout: 4000 });
      return true;
    } catch {
      return false;
    }
  }

  async isServerReady(): Promise<boolean> {
    try {
      const res = await fetch(`${this.serverHttpUrl}/ready`, {
        signal: AbortSignal.timeout(1500),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async getStatus(): Promise<SpeechEngineStatus> {
    const [bin, ffmpegInstalled, serverRunning] = await Promise.all([
      this.resolveBinary(),
      this.hasFfmpeg(),
      this.isServerReady(),
    ]);

    const catalog: Array<{
      name: string;
      repo: string;
      role: "asr" | "diarization";
    }> = [
      {
        name: "nemotron-3.5",
        repo: "nvidia/nemotron-3.5-asr-streaming-0.6b",
        role: "asr",
      },
      {
        name: "parakeet-tdt",
        repo: "nvidia/parakeet-tdt-0.6b-v3",
        role: "asr",
      },
      {
        name: "parakeet-ctc",
        repo: "nvidia/parakeet-ctc-1.1b",
        role: "asr",
      },
      {
        name: "nemotron-en",
        repo: "nvidia/nemotron-speech-streaming-en-0.6b",
        role: "asr",
      },
      {
        name: "nemotron-3-diarization",
        repo: "nvidia/Nemotron-3-Diarization",
        role: "diarization",
      },
      {
        name: "sortformer",
        repo: "nvidia/diar_streaming_sortformer_4spk-v2",
        role: "diarization",
      },
    ];

    return {
      installed: Boolean(bin),
      binaryPath: bin?.path ?? null,
      version: bin?.version ?? null,
      ffmpegInstalled,
      serverRunning,
      serverUrl: this.serverHttpUrl,
      streamingAsrModel: this.activeStreamingAsr,
      offlineAsrModel: DEFAULT_OFFLINE_ASR,
      diarizationModel: this.activeDiarModel,
      cachedModels: catalog.map((m) => ({
        ...m,
        cached: this.isRepoCached(m.repo),
      })),
    };
  }

  /**
   * Starts (or reuses) local `nemo-speech serve` loaded with streaming ASR
   * (Nemotron 3.5) and Nemotron 3 Diarization for real-time WebSocket streaming.
   */
  async ensureStreamingServer(options?: {
    asrModel?: string;
    diarModel?: string;
  }): Promise<void> {
    const wantedAsr = options?.asrModel || DEFAULT_STREAMING_ASR;
    const wantedDiar = options?.diarModel || DEFAULT_DIAR_MODEL;

    if (
      (await this.isServerReady()) &&
      wantedAsr === this.activeStreamingAsr &&
      wantedDiar === this.activeDiarModel
    ) {
      return;
    }

    if (this.startingPromise) {
      return this.startingPromise;
    }

    this.startingPromise = (async () => {
      try {
        const bin = await this.resolveBinary();
        if (!bin) {
          throw new Error(
            "nemo-speech binary not found. Install NeMo-Speech.cpp first: curl -fsSL https://github.com/NVIDIA/NeMo-Speech.cpp/raw/main/scripts/install.sh | sh"
          );
        }

        if (this.serverProc && !this.serverProc.killed) {
          this.serverProc.kill("SIGTERM");
          this.serverProc = null;
          await new Promise((r) => setTimeout(r, 400));
        }

        this.activeStreamingAsr = wantedAsr;
        this.activeDiarModel = wantedDiar;

        const args = [
          "serve",
          "--host",
          NEMO_HOST,
          "--port",
          String(NEMO_PORT),
          "--asr-model",
          wantedAsr,
          "--diar-model",
          wantedDiar,
          "--no-ui",
        ];

        console.log(`[speech] Starting local nemo-speech server: ${NEMO_BIN} ${args.join(" ")}`);
        const child = spawn(NEMO_BIN, args, {
          stdio: ["ignore", "pipe", "pipe"],
        });
        this.serverProc = child;

        let stderrTail = "";
        child.stderr?.on("data", (chunk: Buffer) => {
          stderrTail = (stderrTail + chunk.toString()).slice(-2000);
        });
        child.on("exit", (code) => {
          if (this.serverProc === child) {
            this.serverProc = null;
          }
          if (code !== 0 && code !== null) {
            console.warn(`[speech] nemo-speech serve exited with code ${code}`);
          }
        });

        const deadline = Date.now() + 90_000;
        while (Date.now() < deadline) {
          if (child.exitCode !== null) {
            throw new Error(
              `nemo-speech serve exited prematurely (${child.exitCode}): ${stderrTail}`
            );
          }
          if (await this.isServerReady()) {
            console.log(`[speech] Local nemo-speech server ready at ${this.serverHttpUrl}`);
            return;
          }
          await new Promise((r) => setTimeout(r, 500));
        }
        throw new Error("Timed out waiting for nemo-speech serve to become ready.");
      } finally {
        this.startingPromise = null;
      }
    })();

    return this.startingPromise;
  }

  /**
   * Converts any audio/video file to 16kHz mono PCM16 WAV using ffmpeg.
   */
  async convertToWav16kMono(
    inputPath: string,
    signal?: AbortSignal
  ): Promise<{
    wavPath: string;
    cleanup: () => void;
  }> {
    const tmpWav = path.join(
      os.tmpdir(),
      `dialogger-${crypto.randomBytes(6).toString("hex")}.wav`
    );
    await execFileAsync(
      "ffmpeg",
      [
        "-y",
        "-i",
        inputPath,
        "-ac",
        "1",
        "-ar",
        "16000",
        "-c:a",
        "pcm_s16le",
        tmpWav,
      ],
      { timeout: 120_000, signal }
    );
    return {
      wavPath: tmpWav,
      cleanup: () => {
        try {
          fs.unlinkSync(tmpWav);
        } catch {
          // ignore
        }
      },
    };
  }

  /**
   * Transcribes & diarizes an audio file locally using NVIDIA Parakeet TDT v3
   * (or Nemotron 3.5 ASR) paired with NVIDIA Nemotron 3 Diarization (8 speakers,
   * overlapping speech) via `nemo-speech`. Supports enrolled voice seeds and cancellation.
   */
  async transcribeAndDiarizeFile(
    inputPath: string,
    options?: {
      asrModel?: string;
      diarizationModel?: string;
      seeds?: VoiceSeed[];
      signal?: AbortSignal;
    }
  ): Promise<FileTranscriptionResult> {
    const bin = await this.resolveBinary();
    if (!bin) {
      throw new Error(
        "nemo-speech binary is not installed. Run: curl -fsSL https://github.com/NVIDIA/NeMo-Speech.cpp/raw/main/scripts/install.sh | sh"
      );
    }

    const asrModel = options?.asrModel || DEFAULT_OFFLINE_ASR;
    const diarizationModel = options?.diarizationModel || DEFAULT_DIAR_MODEL;
    const seeds = options?.seeds || [];

    const { wavPath, cleanup } = await this.convertToWav16kMono(
      inputPath,
      options?.signal
    );
    try {
      let slotNames = new Map<number, string>();
      let globalSegments: DiarizationSegment[] = [];

      // If voice seeds exist, run seeded global Nemotron 3 Diarization first so
      // offline Parakeet uploads also recognize enrolled speakers!
      if (seeds.length > 0) {
        const diarRes = await this.diarizeWavWithSeeds(wavPath, {
          diarizationModel,
          seeds,
          signal: options?.signal,
        });
        globalSegments = diarRes.segments;
        slotNames = diarRes.slotNames;
      }

      const cliArgs = [
        "transcribe",
        wavPath,
        "--model",
        asrModel,
        "--json",
      ];
      if (globalSegments.length === 0) {
        cliArgs.push("--diarize", "--diar-model", diarizationModel);
      }

      const { stdout } = await execFileAsync(NEMO_BIN, cliArgs, {
        timeout: 600_000,
        maxBuffer: 64 * 1024 * 1024,
        signal: options?.signal,
      });

      const parsed = JSON.parse(stdout.trim()) as {
        text?: string;
        duration?: number;
        words?: WordTiming[];
      };

      const rawWords = Array.isArray(parsed.words) ? parsed.words : [];
      const words =
        globalSegments.length > 0
          ? alignWordsToDiarization(rawWords, globalSegments)
          : rawWords;
      const turns = wordsToDiarizedTurns(words);
      for (const t of turns) {
        const enrolled = slotNames.get(t.speakerChannel);
        if (enrolled && !/^Speaker\s+\d+$/i.test(enrolled)) {
          t.speakerName = enrolled;
        }
      }

      // Fallback if model returned text without word timings
      if (turns.length === 0 && parsed.text?.trim()) {
        turns.push({
          speakerChannel: 1,
          text: parsed.text.trim(),
          startSec: 0,
          endSec: Number((parsed.duration || 0).toFixed(2)),
          overlap: false,
          overlapWithChannels: [],
          words: [],
        });
      }

      return {
        text: parsed.text || "",
        duration: parsed.duration || 0,
        asrModel,
        diarizationModel,
        words,
        turns,
        slotNames,
      };
    } finally {
      cleanup();
    }
  }

  /**
   * Runs one unbroken NVIDIA Nemotron 3 Diarization pass over a 16kHz mono WAV,
   * optionally prepending enrolled VoiceSeeds so Nemotron 3's Arrival-Order
   * Speaker Cache locks known speakers to stable slots 1..K.
   */
  async diarizeWavWithSeeds(
    wavPath: string,
    options?: {
      diarizationModel?: string;
      seeds?: VoiceSeed[];
      signal?: AbortSignal;
    }
  ): Promise<{
    segments: DiarizationSegment[];
    slotNames: Map<number, string>;
  }> {
    const diarModel = options?.diarizationModel || DEFAULT_DIAR_MODEL;
    const seeds = options?.seeds || [];
    const { seededWavPath, seedDurationSec, slotNames, cleanup } =
      voiceBank.buildSeededWav(wavPath, seeds);

    try {
      const { stdout } = await execFileAsync(
        NEMO_BIN,
        [
          "diarize",
          seededWavPath,
          "--model",
          diarModel,
          "--format",
          "json",
        ],
        {
          timeout: 600_000,
          maxBuffer: 64 * 1024 * 1024,
          signal: options?.signal,
        }
      );

      // Extract the JSON object from stdout (ignoring [nemo-speech] status lines if any)
      const firstBrace = stdout.indexOf("{");
      const lastBrace = stdout.lastIndexOf("}");
      const jsonStr =
        firstBrace >= 0 && lastBrace > firstBrace
          ? stdout.slice(firstBrace, lastBrace + 1)
          : "{}";
      const parsed = JSON.parse(jsonStr) as {
        segments?: Array<{ start: number; end: number; speaker: number }>;
      };

      const segments: DiarizationSegment[] = [];
      for (const s of parsed.segments || []) {
        const start = Number((s.start - seedDurationSec).toFixed(3));
        const end = Number((s.end - seedDurationSec).toFixed(3));
        if (end <= 0.05) continue;
        segments.push({
          start: Math.max(0, start),
          end,
          speaker: Math.max(1, Math.round(s.speaker)),
        });
      }
      segments.sort((a, b) => a.start - b.start);

      return { segments, slotNames };
    } finally {
      cleanup();
    }
  }

  /**
   * Streams an audio file with globally-consistent Nemotron 3 Diarization + live
   * Nemotron 3.5 Streaming ASR + Voice Seed Enrollment.
   *
   * - Clips <= 5 min run ONE single unbroken Nemotron 3 Diarization pass.
   * - Longer recordings (e.g. 2h debates) run in 2-minute super-windows,
   *   carrying enrolled voices + auto-bootstrapped speaker seeds from Window 1
   *   into Window 2, 3, ... so speakers stay locked across the entire recording
   *   AND any live user speaker correction is immediately picked up on the next window!
   */
  async streamTranscribeAndDiarizeFile(
    inputPath: string,
    options: {
      asrModel?: string;
      diarizationModel?: string;
      getVoiceSeeds?: () => VoiceSeed[];
      signal?: AbortSignal;
      onStatus?: (message: string) => void;
      onPartial?: (text: string, audioProcessedSec: number) => void;
      onTurns?: (
        turns: DiarizedTurnDraft[],
        audioProcessedSec: number,
        windowInfo?: { windowIndex: number; slotNames: Map<number, string> }
      ) => Promise<void> | void;
      onProgress?: (processedSec: number, totalSec: number) => void;
    }
  ): Promise<{ totalTurns: number; durationSec: number; cancelled: boolean }> {
    const asrModel =
      options.asrModel &&
      options.asrModel !== "parakeet-tdt" &&
      options.asrModel !== "parakeet-ctc"
        ? options.asrModel
        : DEFAULT_STREAMING_ASR;
    const diarModel = options.diarizationModel || DEFAULT_DIAR_MODEL;

    await this.ensureStreamingServer({ asrModel, diarModel });
    const { wavPath, cleanup } = await this.convertToWav16kMono(
      inputPath,
      options.signal
    );

    const tempSeedsDir = path.join(
      os.tmpdir(),
      `dialogger-autoseeds-${crypto.randomBytes(5).toString("hex")}`
    );
    fs.mkdirSync(tempSeedsDir, { recursive: true });
    // Session-scoped auto-bootstrapped speaker seeds (for unnamed speakers across super-windows)
    const autoSeeds = new Map<number, VoiceSeed>();

    try {
      const fullPcm = readPcm16FromWav(wavPath);
      const bytesPerSec = 16000 * 2;
      const totalSec = fullPcm.length / bytesPerSec;
      const chunkBytes = 5120; // 160 ms per streaming frame

      // Single pass for clips <= 5 min; 2-minute rolling super-windows for longer debates
      const superWindowSec = totalSec <= 300 ? totalSec + 1 : 120;
      const superWindowBytes = Math.floor(superWindowSec * bytesPerSec);

      let totalTurns = 0;
      let cancelled = false;
      let windowIndex = 0;

      for (
        let winByteStart = 0;
        winByteStart < fullPcm.length;
        winByteStart += superWindowBytes, windowIndex++
      ) {
        if (options.signal?.aborted) {
          cancelled = true;
          break;
        }

        const winByteEnd = Math.min(fullPcm.length, winByteStart + superWindowBytes);
        const winPcm = fullPcm.subarray(winByteStart, winByteEnd);
        const winOffsetSec = winByteStart / bytesPerSec;
        const winDurSec = winPcm.length / bytesPerSec;
        if (winDurSec < 0.25) break;

        const winWavPath = path.join(tempSeedsDir, `win-${winByteStart}.wav`);
        writePcm16Wav(winPcm, winWavPath, 16000);

        // Merge user's enrolled voice seeds (including any live corrections!) + auto-bootstrapped seeds
        const enrolledSeeds = options.getVoiceSeeds ? options.getVoiceSeeds() : [];
        const combinedSeeds: VoiceSeed[] = [...enrolledSeeds];
        const usedIds = new Set(combinedSeeds.map((s) => s.id));
        for (const auto of autoSeeds.values()) {
          if (combinedSeeds.length >= 6) break;
          if (!usedIds.has(auto.id)) {
            combinedSeeds.push({ ...auto, slot: combinedSeeds.length + 1 });
            usedIds.add(auto.id);
          }
        }

        const fmtMin = (s: number) =>
          `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
        const seedNote =
          combinedSeeds.length > 0
            ? ` · ${combinedSeeds.length} voice seed${combinedSeeds.length === 1 ? "" : "s"}`
            : "";
        options.onStatus?.(
          `Global Nemotron 3 Diarization ${fmtMin(winOffsetSec)}–${fmtMin(winOffsetSec + winDurSec)}${seedNote}…`
        );

        let globalSegments: DiarizationSegment[] = [];
        let slotNames = new Map<number, string>();
        try {
          const diarRes = await this.diarizeWavWithSeeds(winWavPath, {
            diarizationModel: diarModel,
            seeds: combinedSeeds,
            signal: options.signal,
          });
          globalSegments = diarRes.segments;
          slotNames = diarRes.slotNames;
        } catch (err) {
          if (options.signal?.aborted) {
            cancelled = true;
            break;
          }
          console.warn("[speech] Global diarize failed, falling back to inline diarization:", err);
        }

        if (options.signal?.aborted) {
          cancelled = true;
          break;
        }

        // Auto-bootstrap clean 4s voice seeds for newly discovered speakers in this super-window
        // so subsequent 2-minute windows lock onto the exact same speaker slots!
        if (winByteEnd < fullPcm.length && globalSegments.length > 0) {
          const bestSegBySpeaker = new Map<number, DiarizationSegment>();
          for (const seg of globalSegments) {
            if (slotNames.has(seg.speaker) || autoSeeds.has(seg.speaker)) continue;
            const dur = seg.end - seg.start;
            const prev = bestSegBySpeaker.get(seg.speaker);
            if (dur >= 2.0 && (!prev || dur > prev.end - prev.start)) {
              bestSegBySpeaker.set(seg.speaker, seg);
            }
          }
          for (const [spk, seg] of bestSegBySpeaker.entries()) {
            const sStart = Math.max(0, Math.floor(seg.start * bytesPerSec)) & ~1;
            const sLen = Math.min(
              Math.floor(4.2 * bytesPerSec),
              Math.floor((seg.end - seg.start) * bytesPerSec)
            ) & ~1;
            if (sStart + sLen <= winPcm.length && sLen >= bytesPerSec * 1.5) {
              const seedFile = path.join(tempSeedsDir, `autoseed-spk-${spk}.wav`);
              writePcm16Wav(winPcm.subarray(sStart, sStart + sLen), seedFile, 16000);
              autoSeeds.set(spk, {
                slot: spk,
                id: `auto_spk_${spk}`,
                name: `Speaker ${spk}`,
                wavPath: seedFile,
                durationSec: Number((sLen / bytesPerSec).toFixed(2)),
              });
            }
          }
        }

        // Now stream this super-window through Nemotron 3.5 ASR (super fast with inline diarization off!)
        // and align every word to our globally-consistent Nemotron 3 Diarization segments!
        const useGlobalAlignment = globalSegments.length > 0;

        await new Promise<void>((resolve, reject) => {
          const ws = new WebSocket(this.serverWsUrl);
          let partialAcc = "";
          let lastDeltaEndedSentence = false;
          let finished = false;
          let pendingHandlers = Promise.resolve();

          let subOffsetSec = 0; // offset within this super-window
          let subAudioSec = 0;
          let waitingForCommitResolve: (() => void) | null = null;
          let finalCommitSent = false;

          const finish = (err?: Error) => {
            if (finished) return;
            finished = true;
            waitingForCommitResolve?.();
            waitingForCommitResolve = null;
            try {
              if (ws.readyState === WebSocket.OPEN) ws.close();
            } catch {
              // ignore
            }
            pendingHandlers.finally(() => {
              if (err) reject(err);
              else resolve();
            });
          };

          const onAbort = () => {
            cancelled = true;
            finish();
          };
          if (options.signal?.aborted) {
            onAbort();
            return;
          }
          options.signal?.addEventListener("abort", onAbort, { once: true });

          ws.addEventListener("error", () =>
            finish(new Error("Connection to the local speech runtime failed"))
          );
          ws.addEventListener("close", () => finish());

          const computePcm16Rms = (chunk: Buffer): number => {
            const samples = Math.floor(chunk.length / 2);
            if (samples === 0) return 0;
            let sumSq = 0;
            for (let i = 0; i < samples; i++) {
              const s = chunk.readInt16LE(i * 2) / 32768;
              sumSq += s * s;
            }
            return Math.sqrt(sumSq / samples);
          };

          const commitAndAwait = async (): Promise<void> => {
            if (finished || cancelled || ws.readyState !== WebSocket.OPEN) return;
            await new Promise<void>((res) => {
              const timer = setTimeout(() => {
                if (waitingForCommitResolve === done) {
                  waitingForCommitResolve = null;
                }
                res();
              }, 30_000);
              const done = () => {
                clearTimeout(timer);
                res();
              };
              waitingForCommitResolve = done;
              ws.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
            });
          };

          ws.addEventListener("message", ({ data: raw }) => {
            if (finished) return;
            let evt: {
              type?: string;
              delta?: string;
              transcript?: string;
              audio_processed?: number;
              words?: WordTiming[];
              message?: string;
            };
            try {
              evt = JSON.parse(raw.toString());
            } catch {
              return;
            }

            if (evt.type === "session.created") {
              ws.send(
                JSON.stringify({
                  type: "session.update",
                  session: {
                    sample_rate: 16000,
                    word_timestamps: true,
                    speaker_diarization: !useGlobalAlignment,
                    automatic_punctuation: true,
                    endpointing_ms: 850,
                  },
                })
              );
              return;
            }

            if (evt.type === "session.updated") {
              void (async () => {
                let lastProgressAt = 0;
                for (let off = 0; off < winPcm.length; off += chunkBytes) {
                  if (finished || cancelled || ws.readyState !== WebSocket.OPEN) return;
                  const frame = winPcm.subarray(
                    off,
                    Math.min(off + chunkBytes, winPcm.length)
                  );
                  ws.send(frame);

                  const frameSec = frame.length / bytesPerSec;
                  subAudioSec += frameSec;
                  const globalSentSec = Math.min(
                    totalSec,
                    winOffsetSec + (off + frame.length) / bytesPerSec
                  );

                  if (globalSentSec - lastProgressAt >= 2) {
                    lastProgressAt = globalSentSec;
                    options.onProgress?.(globalSentSec, totalSec);
                  }

                  const isQuietDip = subAudioSec >= 20 && computePcm16Rms(frame) < 0.018;
                  const shouldCommit =
                    (subAudioSec >= 18 && lastDeltaEndedSentence) ||
                    isQuietDip ||
                    subAudioSec >= 30;

                  if (shouldCommit) {
                    await commitAndAwait();
                  } else {
                    const delayMs = ws.bufferedAmount > 64 * 1024 ? 50 : 12;
                    await new Promise((r) => setTimeout(r, delayMs));
                  }
                }

                if (!finished && !cancelled && ws.readyState === WebSocket.OPEN) {
                  finalCommitSent = true;
                  if (subAudioSec > 0.1) {
                    await commitAndAwait();
                  }
                  options.signal?.removeEventListener("abort", onAbort);
                  finish();
                }
              })();
              return;
            }

            if (evt.type === "conversation.item.input_audio_transcription.delta") {
              if (evt.delta) {
                partialAcc += evt.delta;
                lastDeltaEndedSentence = /[.?!]["')\]\s]*$/.test(partialAcc);
                options.onPartial?.(
                  partialAcc.trim(),
                  winOffsetSec + subOffsetSec + (evt.audio_processed || subAudioSec)
                );
              }
              return;
            }

            if (evt.type === "conversation.item.input_audio_transcription.completed") {
              const localSegOffset = subOffsetSec;
              const segDur = evt.audio_processed || subAudioSec;
              subOffsetSec = Number((subOffsetSec + segDur).toFixed(2));
              subAudioSec = 0;
              partialAcc = "";
              lastDeltaEndedSentence = false;
              options.onPartial?.("", winOffsetSec + subOffsetSec);

              const rawWords = Array.isArray(evt.words) ? evt.words : [];
              // First compute timestamps relative to this super-window for exact global diarization alignment
              const localWords: WordTiming[] = rawWords.map((w) => ({
                ...w,
                start: Number((w.start + localSegOffset).toFixed(2)),
                end: Number((w.end + localSegOffset).toFixed(2)),
              }));

              const alignedLocal = useGlobalAlignment
                ? alignWordsToDiarization(localWords, globalSegments)
                : localWords;

              // Shift to absolute full-recording timeline
              const absWords: WordTiming[] = alignedLocal.map((w) => ({
                ...w,
                start: Number((w.start + winOffsetSec).toFixed(2)),
                end: Number((w.end + winOffsetSec).toFixed(2)),
              }));

              const turns =
                absWords.length > 0
                  ? wordsToDiarizedTurns(absWords)
                  : evt.transcript?.trim()
                    ? [
                        {
                          speakerChannel: 1,
                          text: evt.transcript.trim(),
                          startSec: Number((winOffsetSec + localSegOffset).toFixed(2)),
                          endSec: Number((winOffsetSec + subOffsetSec).toFixed(2)),
                          overlap: false,
                          overlapWithChannels: [],
                          words: [],
                        },
                      ]
                    : [];

              // Attach enrolled real speaker names from VoiceSeed slots!
              for (const t of turns) {
                const enrolledName = slotNames.get(t.speakerChannel);
                if (enrolledName && !/^Speaker\s+\d+$/i.test(enrolledName)) {
                  t.speakerName = enrolledName;
                }
              }

              if (turns.length > 0) {
                totalTurns += turns.length;
                const currentWindowIndex = windowIndex;
                const currentSlotNames = new Map(slotNames);
                pendingHandlers = pendingHandlers.then(async () => {
                  if (!cancelled) {
                    await options.onTurns?.(turns, winOffsetSec + subOffsetSec, {
                      windowIndex: currentWindowIndex,
                      slotNames: currentSlotNames,
                    });
                  }
                });
              }
              return;
            }

            if (evt.type === "input_audio_buffer.committed") {
              const resume = waitingForCommitResolve;
              waitingForCommitResolve = null;
              resume?.();
              if (finalCommitSent) {
                options.signal?.removeEventListener("abort", onAbort);
                finish();
              }
              return;
            }

            if (evt.type === "error") {
              options.signal?.removeEventListener("abort", onAbort);
              finish(new Error(evt.message || "Realtime transcription error"));
            }
          });
        });

        try {
          fs.unlinkSync(winWavPath);
        } catch {
          // ignore
        }
      }

      return { totalTurns, durationSec: totalSec, cancelled };
    } finally {
      cleanup();
      try {
        fs.rmSync(tempSeedsDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
  }
}

export const speechEngine = new LocalSpeechEngine();
