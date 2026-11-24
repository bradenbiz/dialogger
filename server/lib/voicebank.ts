import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import type { EnrolledVoiceInfo } from "../../shared/schemas/events";

const execFileAsync = promisify(execFile);

const VOICES_DIR = path.resolve(process.cwd(), ".dialogger-data", "voices");
const REGISTRY_FILE = path.join(VOICES_DIR, "registry.json");

interface StoredVoiceRecord {
  id: string;
  name: string;
  filename: string;
  durationSec: number;
  sampleCount: number;
  updatedAt: string;
}

export interface VoiceSeed {
  slot: number; // 1-based arrival slot in Nemotron 3 Diarization
  id: string;
  name: string;
  wavPath: string;
  durationSec: number;
}

function slugifyName(name: string): string {
  const base = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  return base || `voice-${crypto.randomBytes(3).toString("hex")}`;
}

export function findWavDataOffset(buf: Buffer): number {
  if (buf.length < 44) return 0;
  let offset = 12;
  while (offset + 8 <= buf.length) {
    const id = buf.toString("ascii", offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    if (id === "data") return offset + 8;
    offset += 8 + size + (size % 2);
  }
  return 44;
}

export function writePcm16Wav(pcm: Buffer, outPath: string, sampleRate = 16000): void {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16); // PCM chunk size
  header.writeUInt16LE(1, 20); // PCM format
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28); // byte rate
  header.writeUInt16LE(2, 32); // block align
  header.writeUInt16LE(16, 34); // bits per sample
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  fs.writeFileSync(outPath, Buffer.concat([header, pcm]));
}

export function readPcm16FromWav(wavPath: string): Buffer {
  const buf = fs.readFileSync(wavPath);
  return buf.subarray(findWavDataOffset(buf));
}

class VoiceBank {
  private records = new Map<string, StoredVoiceRecord>();

  constructor() {
    this.load();
  }

  private load(): void {
    try {
      if (!fs.existsSync(REGISTRY_FILE)) return;
      const raw = JSON.parse(
        fs.readFileSync(REGISTRY_FILE, "utf8")
      ) as StoredVoiceRecord[];
      if (Array.isArray(raw)) {
        for (const r of raw) {
          if (r?.id && r?.filename && fs.existsSync(path.join(VOICES_DIR, r.filename))) {
            this.records.set(r.id, r);
          }
        }
      }
    } catch (err) {
      console.warn("[voicebank] Failed to load voice registry:", err);
    }
  }

  private persist(): void {
    fs.mkdirSync(VOICES_DIR, { recursive: true });
    const tmp = `${REGISTRY_FILE}.tmp`;
    fs.writeFileSync(
      tmp,
      JSON.stringify(Array.from(this.records.values()), null, 2),
      "utf8"
    );
    fs.renameSync(tmp, REGISTRY_FILE);
  }

  listVoices(): EnrolledVoiceInfo[] {
    return Array.from(this.records.values())
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((r) => ({
        id: r.id,
        name: r.name,
        durationSec: r.durationSec,
        sampleCount: r.sampleCount,
        updatedAt: r.updatedAt,
      }));
  }

  hasVoiceForName(name: string): boolean {
    const id = slugifyName(name);
    return this.records.has(id);
  }

  deleteVoice(id: string): boolean {
    const rec = this.records.get(id);
    if (!rec) return false;
    this.records.delete(id);
    try {
      fs.unlinkSync(path.join(VOICES_DIR, rec.filename));
    } catch {
      // ignore
    }
    this.persist();
    return true;
  }

  /**
   * Enrolls (or refines) a speaker's acoustic voice seed from a confirmed
   * transcript snippet [startSec, endSec]. Uses Nemotron 3 Diarization's
   * Arrival-Order Speaker Cache so future diarization locks onto this voice!
   */
  async enrollFromAudioSnippet(params: {
    name: string;
    audioPath: string;
    startSec: number;
    endSec: number;
  }): Promise<EnrolledVoiceInfo | null> {
    const cleanName = params.name.trim();
    if (!cleanName || /^Speaker\s+\d+$/i.test(cleanName)) {
      return null;
    }

    const rawDur = Math.max(0, params.endSec - params.startSec);
    if (rawDur < 1.2 || !fs.existsSync(params.audioPath)) {
      return null;
    }

    fs.mkdirSync(VOICES_DIR, { recursive: true });
    const id = slugifyName(cleanName);
    const filename = `${id}.wav`;
    const outPath = path.join(VOICES_DIR, filename);

    // Grab up to 5.5 seconds of clean speech from the middle/start of the turn
    const clipDur = Math.min(5.5, rawDur);
    const clipStart = Math.max(0, params.startSec);
    const tmpNew = path.join(os.tmpdir(), `dialogger-seed-${crypto.randomBytes(5).toString("hex")}.wav`);

    try {
      await execFileAsync(
        "ffmpeg",
        [
          "-y",
          "-ss",
          String(clipStart),
          "-i",
          params.audioPath,
          "-t",
          String(clipDur),
          "-ac",
          "1",
          "-ar",
          "16000",
          "-c:a",
          "pcm_s16le",
          tmpNew,
        ],
        { timeout: 30_000 }
      );

      const newPcm = readPcm16FromWav(tmpNew);
      if (newPcm.length < 16000 * 2 * 1.0) {
        return null;
      }

      const existing = this.records.get(id);
      let finalPcm = newPcm;

      // If we already have a short seed (< 5s), concatenate up to 6.5s max for a richer voiceprint!
      if (existing && fs.existsSync(outPath)) {
        const oldPcm = readPcm16FromWav(outPath);
        const maxBytes = Math.floor(16000 * 2 * 6.5);
        if (oldPcm.length < maxBytes) {
          const gap = Buffer.alloc(16000 * 2 * 0.25); // 250ms silence separator
          const combined = Buffer.concat([oldPcm, gap, newPcm]);
          finalPcm =
            combined.length > maxBytes ? combined.subarray(0, maxBytes) : combined;
        } else if (newPcm.length >= 16000 * 2 * 3.0) {
          // Keep the newest high-confidence half + old half so voice adapts cleanly
          const half = Math.floor(16000 * 2 * 3.0);
          const gap = Buffer.alloc(16000 * 2 * 0.2);
          finalPcm = Buffer.concat([
            oldPcm.subarray(0, Math.min(oldPcm.length, half)),
            gap,
            newPcm.subarray(0, Math.min(newPcm.length, half)),
          ]);
        }
      }

      writePcm16Wav(finalPcm, outPath, 16000);
      const finalDur = Number((finalPcm.length / (16000 * 2)).toFixed(2));

      const record: StoredVoiceRecord = {
        id,
        name: cleanName,
        filename,
        durationSec: finalDur,
        sampleCount: (existing?.sampleCount || 0) + 1,
        updatedAt: new Date().toISOString(),
      };
      this.records.set(id, record);
      this.persist();

      console.log(
        `[voicebank] Enrolled voice "${cleanName}" (${finalDur}s, ${record.sampleCount} sample(s))`
      );
      return {
        id: record.id,
        name: record.name,
        durationSec: record.durationSec,
        sampleCount: record.sampleCount,
        updatedAt: record.updatedAt,
      };
    } catch (err) {
      console.warn("[voicebank] Failed to enroll voice snippet:", err);
      return null;
    } finally {
      try {
        fs.unlinkSync(tmpNew);
      } catch {
        // ignore
      }
    }
  }

  /**
   * Selects up to `maxSeeds` enrolled voices to prepend to Nemotron 3 Diarization.
   * Prioritizes voices explicitly referenced by name in the current session.
   */
  getSeeds(preferredNames: string[] = [], maxSeeds = 6): VoiceSeed[] {
    const all = Array.from(this.records.values()).filter((r) =>
      fs.existsSync(path.join(VOICES_DIR, r.filename))
    );
    if (all.length === 0) return [];

    const preferredIds = new Set(preferredNames.map(slugifyName));
    const ordered = [
      ...all.filter((r) => preferredIds.has(r.id)),
      ...all
        .filter((r) => !preferredIds.has(r.id))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    ].slice(0, maxSeeds);

    return ordered.map((r, idx) => ({
      slot: idx + 1,
      id: r.id,
      name: r.name,
      wavPath: path.join(VOICES_DIR, r.filename),
      durationSec: r.durationSec,
    }));
  }

  /**
   * Builds a temporary 16kHz PCM16 WAV with voice seeds prepended in arrival order
   * so Nemotron 3 Diarization locks Slots 1..K to the enrolled speakers before the
   * target audio starts.
   */
  buildSeededWav(
    targetWavPath: string,
    seeds: VoiceSeed[]
  ): {
    seededWavPath: string;
    seedDurationSec: number;
    slotNames: Map<number, string>;
    cleanup: () => void;
  } {
    if (seeds.length === 0) {
      return {
        seededWavPath: targetWavPath,
        seedDurationSec: 0,
        slotNames: new Map(),
        cleanup: () => {},
      };
    }

    const bytesPerSec = 16000 * 2;
    const gapBetween = Buffer.alloc(Math.floor(bytesPerSec * 0.55)); // 550ms silence between seeds
    const gapAfterSeeds = Buffer.alloc(Math.floor(bytesPerSec * 0.75)); // 750ms before real audio
    const maxSeedBytes = Math.floor(bytesPerSec * 4.5);

    const parts: Buffer[] = [];
    const slotNames = new Map<number, string>();
    let prefixBytes = 0;

    seeds.forEach((seed, idx) => {
      if (!fs.existsSync(seed.wavPath)) return;
      const raw = readPcm16FromWav(seed.wavPath);
      const clipped = raw.length > maxSeedBytes ? raw.subarray(0, maxSeedBytes) : raw;
      if (clipped.length < bytesPerSec * 0.8) return;

      parts.push(clipped);
      prefixBytes += clipped.length;
      slotNames.set(idx + 1, seed.name);

      const sep = idx === seeds.length - 1 ? gapAfterSeeds : gapBetween;
      parts.push(sep);
      prefixBytes += sep.length;
    });

    if (parts.length === 0) {
      return {
        seededWavPath: targetWavPath,
        seedDurationSec: 0,
        slotNames: new Map(),
        cleanup: () => {},
      };
    }

    const targetPcm = readPcm16FromWav(targetWavPath);
    parts.push(targetPcm);

    const outPath = path.join(
      os.tmpdir(),
      `dialogger-seeded-${crypto.randomBytes(6).toString("hex")}.wav`
    );
    writePcm16Wav(Buffer.concat(parts), outPath, 16000);

    return {
      seededWavPath: outPath,
      seedDurationSec: Number((prefixBytes / bytesPerSec).toFixed(3)),
      slotNames,
      cleanup: () => {
        try {
          fs.unlinkSync(outPath);
        } catch {
          // ignore
        }
      },
    };
  }
}

export const voiceBank = new VoiceBank();
