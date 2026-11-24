import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

const execFileAsync = promisify(execFile);

// yt-dlp needs a JS runtime to solve YouTube's player challenges and only enables
// Deno by default. Point it at the Node binary already running this server.
const YT_DLP_JS_RUNTIME_ARGS = ["--js-runtimes", `node:${process.execPath}`];

const YT_URL_RE =
  /^https?:\/\/(?:www\.|m\.|music\.)?(?:youtube\.com\/(?:watch\?|shorts\/|live\/|embed\/)|youtu\.be\/)/i;

export interface YouTubeMetadata {
  id: string;
  title: string;
  channel: string;
  durationSec: number;
  webpageUrl: string;
}

export interface DownloadedYouTubeAudio {
  metadata: YouTubeMetadata;
  rawPath: string;
  durationSec: number;
  clipStartSec: number;
  cleanup: () => void;
}

export function isValidYouTubeUrl(url: string): boolean {
  return YT_URL_RE.test(url.trim());
}

export async function hasYtDlp(): Promise<boolean> {
  try {
    await execFileAsync("yt-dlp", ["--version"], { timeout: 4000 });
    return true;
  } catch {
    return false;
  }
}

/** yt-dlp progress line for plain (non-section) downloads: bytes so far and total. */
const YT_DLP_PROGRESS_TEMPLATE =
  "download:DLPROG %(progress.downloaded_bytes)s %(progress.total_bytes)s %(progress.total_bytes_estimate)s";
const DLPROG_RE = /DLPROG (\S+) (\S+) (\S+)/;
/** ffmpeg status line emitted when yt-dlp downloads a --download-sections clip. */
const FFMPEG_TIME_RE = /time=(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/;

/**
 * Parses one line of yt-dlp/ffmpeg output into a 0..1 download fraction.
 * `clipLengthSec` is needed for section downloads, where ffmpeg only reports elapsed media time.
 */
export function parseDownloadProgress(
  line: string,
  clipLengthSec: number
): number | null {
  const dl = DLPROG_RE.exec(line);
  if (dl) {
    const done = Number(dl[1]);
    const total = Number(dl[2]) || Number(dl[3]);
    if (Number.isFinite(done) && Number.isFinite(total) && total > 0) {
      return Math.min(1, Math.max(0, done / total));
    }
    return null;
  }
  const t = FFMPEG_TIME_RE.exec(line);
  if (t && clipLengthSec > 0) {
    const sec = Number(t[1]) * 3600 + Number(t[2]) * 60 + Number(t[3]);
    return Math.min(1, Math.max(0, sec / clipLengthSec));
  }
  return null;
}

/** Runs yt-dlp, streaming its stdout/stderr line by line (lines may end in \r or \n). */
function runYtDlp(
  args: string[],
  options: { timeoutMs: number; signal?: AbortSignal; onLine?: (line: string) => void }
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("yt-dlp", args, {
      signal: options.signal,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderrTail = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), options.timeoutMs);

    const makeLineReader = (isStderr: boolean) => {
      let buf = "";
      return (chunk: Buffer) => {
        const text = chunk.toString("utf8");
        if (isStderr) stderrTail = (stderrTail + text).slice(-4000);
        buf += text;
        const parts = buf.split(/\r\n|\r|\n/);
        buf = parts.pop() ?? "";
        for (const part of parts) options.onLine?.(part);
      };
    };
    child.stdout.on("data", makeLineReader(false));
    child.stderr.on("data", makeLineReader(true));

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code, sig) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve();
        return;
      }
      const errLines = stderrTail
        .split(/\r|\n/)
        .filter((l) => /ERROR/.test(l))
        .join(" ")
        .trim();
      reject(
        new Error(
          `Command failed: yt-dlp ${args.join(" ")} ${
            errLines || (sig ? `(killed by ${sig})` : `(exit code ${code})`)
          }`
        )
      );
    });
  });
}

export async function fetchYouTubeMetadata(url: string): Promise<YouTubeMetadata> {
  if (!isValidYouTubeUrl(url)) {
    throw new Error("Please enter a valid public YouTube video URL.");
  }

  try {
    const { stdout } = await execFileAsync(
      "yt-dlp",
      [
        ...YT_DLP_JS_RUNTIME_ARGS,
        "--dump-single-json",
        "--no-warnings",
        "--no-playlist",
        "--skip-download",
        url.trim(),
      ],
      { timeout: 30_000, maxBuffer: 16 * 1024 * 1024 }
    );
    const data = JSON.parse(stdout.trim()) as {
      id?: string;
      title?: string;
      channel?: string;
      uploader?: string;
      duration?: number;
      webpage_url?: string;
      is_live?: boolean;
    };

    if (data.is_live) {
      throw new Error(
        "This video is currently live. Wait until the stream finishes before importing it."
      );
    }

    return {
      id: data.id || "video",
      title: data.title || "YouTube Audio",
      channel: data.channel || data.uploader || "",
      durationSec: Math.max(0, Number(data.duration || 0)),
      webpageUrl: data.webpage_url || url.trim(),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/sign in to confirm|bot|429/i.test(msg)) {
      throw new Error(
        "YouTube temporarily rate-limited this request. Wait a moment and try again, or upload a downloaded audio file."
      );
    }
    if (/private|members-only|unavailable|age/i.test(msg)) {
      throw new Error(
        "This YouTube video is private, restricted, or unavailable without a login."
      );
    }
    throw new Error(`Could not inspect YouTube URL: ${msg.slice(0, 260)}`);
  }
}

/**
 * Downloads public YouTube audio via yt-dlp (never uses browser cookies or logins).
 * Supports optional startSec + durationSec clipping so long podcasts can be tested fast.
 */
export async function downloadYouTubeAudio(
  url: string,
  options?: {
    startSec?: number;
    durationSec?: number;
    signal?: AbortSignal;
    /** Called with the download fraction (0..1) as yt-dlp reports progress. */
    onProgress?: (fraction: number) => void;
  }
): Promise<DownloadedYouTubeAudio> {
  const metadata = await fetchYouTubeMetadata(url);

  const tmpDir = path.join(
    os.tmpdir(),
    `dialogger-yt-${crypto.randomBytes(6).toString("hex")}`
  );
  fs.mkdirSync(tmpDir, { recursive: true });

  const cleanup = () => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  };

  const clipStartSec = Math.max(0, Math.floor(options?.startSec || 0));
  const requestedDur =
    options?.durationSec && options.durationSec > 0
      ? Math.floor(options.durationSec)
      : 0;
  const clipEndSec =
    requestedDur > 0 ? clipStartSec + requestedDur : metadata.durationSec;

  const outTemplate = path.join(tmpDir, "source.%(ext)s");

  const runDownload = async (useSection: boolean): Promise<string> => {
    const args = [
      ...YT_DLP_JS_RUNTIME_ARGS,
      "-f",
      "bestaudio/best",
      "--no-playlist",
      "--no-warnings",
      "--newline",
      "--progress-template",
      YT_DLP_PROGRESS_TEMPLATE,
      "-o",
      outTemplate,
    ];
    if (useSection && (clipStartSec > 0 || requestedDur > 0)) {
      const endTag = clipEndSec > clipStartSec ? String(clipEndSec) : "inf";
      args.push("--download-sections", `*${clipStartSec}-${endTag}`);
    }
    args.push(metadata.webpageUrl);

    const clipLengthSec =
      useSection && clipEndSec > clipStartSec ? clipEndSec - clipStartSec : 0;
    await runYtDlp(args, {
      timeoutMs: 300_000,
      signal: options?.signal,
      onLine: (line) => {
        const fraction = parseDownloadProgress(line, clipLengthSec);
        if (fraction !== null) options?.onProgress?.(fraction);
      },
    });

    const files = fs
      .readdirSync(tmpDir)
      .filter((f) => f.startsWith("source.") && !f.endsWith(".part"));
    if (files.length === 0) {
      throw new Error("yt-dlp completed without producing an audio file.");
    }
    return path.join(tmpDir, files[0]);
  };

  try {
    let rawPath: string;
    let clippedAlready = false;

    if (clipStartSec > 0 || requestedDur > 0) {
      try {
        rawPath = await runDownload(true);
        clippedAlready = true;
      } catch {
        // Fallback: download full audio and trim locally with ffmpeg
        rawPath = await runDownload(false);
        clippedAlready = false;
      }
    } else {
      rawPath = await runDownload(false);
    }

    // Always verify actual duration and enforce clip trim with ffmpeg if yt-dlp ignored --download-sections
    let probedDuration = await probeDurationSec(rawPath);
    const needsTrim =
      (!clippedAlready && (clipStartSec > 0 || requestedDur > 0)) ||
      (requestedDur > 0 && probedDuration > requestedDur + 4);

    if (needsTrim) {
      const trimmedPath = path.join(tmpDir, "trimmed.wav");
      const ffArgs = ["-y"];
      if (!clippedAlready && clipStartSec > 0) {
        ffArgs.push("-ss", String(clipStartSec));
      }
      ffArgs.push("-i", rawPath);
      if (requestedDur > 0) {
        ffArgs.push("-t", String(requestedDur));
      }
      ffArgs.push("-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", trimmedPath);
      await execFileAsync("ffmpeg", ffArgs, {
        timeout: 120_000,
        signal: options?.signal,
      });
      rawPath = trimmedPath;
      probedDuration = await probeDurationSec(rawPath);
    }

    return {
      metadata,
      rawPath,
      durationSec: probedDuration || requestedDur || metadata.durationSec,
      clipStartSec,
      cleanup,
    };
  } catch (err) {
    cleanup();
    throw err;
  }
}

export async function probeDurationSec(filePath: string): Promise<number> {
  try {
    const { stdout } = await execFileAsync(
      "ffprobe",
      [
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        filePath,
      ],
      { timeout: 10_000 }
    );
    const val = Number.parseFloat(stdout.trim());
    return Number.isFinite(val) ? Number(val.toFixed(2)) : 0;
  } catch {
    return 0;
  }
}

/**
 * Encodes an input audio file into a compact seekable MP3 for browser playback.
 */
export async function encodePlayableMp3(
  inputPath: string,
  outputPath: string,
  signal?: AbortSignal
): Promise<number> {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  await execFileAsync(
    "ffmpeg",
    [
      "-y",
      "-i",
      inputPath,
      "-vn",
      "-ac",
      "1",
      "-ar",
      "24000",
      "-b:a",
      "96k",
      outputPath,
    ],
    { timeout: 180_000, signal }
  );
  return probeDurationSec(outputPath);
}
