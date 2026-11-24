#!/usr/bin/env tsx
/**
 * Dialogger Agent CLI
 *
 * Allows any agent or model (Claude Code, Codex, Antigravity, scripts) to:
 *   1. Create or inspect a live Dialogue Mapping session
 *   2. Transcribe & diarize local audio with NVIDIA Parakeet TDT v3 / Nemotron 3.5 + Nemotron 3 Diarization
 *   3. Push diarized transcript turns
 *   4. Emit incremental Jeffrey Conklin IBIS Dialogue Map operations live to connected browsers
 */

import fs from "node:fs";
import path from "node:path";

const BASE_URL = (process.env.DIALOGGER_URL || "http://127.0.0.1:4310").replace(
  /\/$/,
  ""
);
const API_KEY = (process.env.DIALOGGER_API_KEY || "").trim();

function parseArgs(argv: string[]): { cmd: string; positionals: string[]; flags: Record<string, string | boolean> } {
  const [cmd = "help", ...rest] = argv;
  const positionals: string[] = [];
  const flags: Record<string, string | boolean> = {};

  for (let i = 0; i < rest.length; i++) {
    const tok = rest[i];
    if (tok.startsWith("--")) {
      const eq = tok.indexOf("=");
      if (eq !== -1) {
        flags[tok.slice(2, eq)] = tok.slice(eq + 1);
      } else {
        const key = tok.slice(2);
        const next = rest[i + 1];
        if (next && !next.startsWith("--")) {
          flags[key] = next;
          i++;
        } else {
          flags[key] = true;
        }
      }
    } else {
      positionals.push(tok);
    }
  }
  return { cmd, positionals, flags };
}

async function api<T>(endpoint: string, init?: RequestInit): Promise<T> {
  const isFormData = init?.body instanceof FormData;
  const headers: Record<string, string> = {};
  if (!isFormData) {
    headers["content-type"] = "application/json";
  }
  if (API_KEY) {
    headers["authorization"] = `Bearer ${API_KEY}`;
  }
  const res = await fetch(`${BASE_URL}${endpoint}`, {
    ...init,
    headers: {
      ...headers,
      ...(init?.headers || {}),
    },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${endpoint}: ${text}`);
  }
  return JSON.parse(text) as T;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function printHelp(): void {
  console.log(`Dialogger CLI — Live Local Diarization & Conklin IBIS Dialogue Mapping

Usage (base URL: ${BASE_URL}, override via DIALOGGER_URL):
  pnpm cli sessions                               List all sessions
  pnpm cli create [--title "..."] [--focus "..."] [--no-auto-map]
  pnpm cli state <sessionId>                      Read full session JSON (turns + IBIS map)
  pnpm cli transcribe <audioFile> [--session <id>] [--asr parakeet-tdt|nemotron-3.5] [--diar nemotron-3-diarization] [--no-map]
  pnpm cli youtube <url> [--session <id>] [--start 0] [--duration 120] [--asr parakeet-tdt] [--no-map]
  pnpm cli turn <sessionId> --speaker 1 [--name Maya] --text "..." [--no-map]
  pnpm cli op <sessionId> [--json '<batch>']      Apply IBIS op batch (or pipe JSON on stdin)
  pnpm cli analyze <sessionId> [--remap]          Run built-in Conklin model mapper
  pnpm cli prompt                                 Print Conklin Dialogue Mapping system prompt & schema
`);
}

async function main(): Promise<void> {
  const { cmd, positionals, flags } = parseArgs(process.argv.slice(2));

  switch (cmd) {
    case "help":
    case "--help":
    case "-h":
      printHelp();
      return;

    case "sessions": {
      const data = await api<{ sessions: unknown[] }>("/api/sessions");
      console.log(JSON.stringify(data.sessions, null, 2));
      return;
    }

    case "create": {
      const data = await api<{ session: { id: string; title: string } }>("/api/sessions", {
        method: "POST",
        body: JSON.stringify({
          title: typeof flags.title === "string" ? flags.title : undefined,
          rootFocus: typeof flags.focus === "string" ? flags.focus : undefined,
          autoMap: flags["no-auto-map"] ? false : true,
        }),
      });
      console.log(
        JSON.stringify(
          {
            id: data.session.id,
            title: data.session.title,
            viewerUrl: `${BASE_URL}/?session=${data.session.id}`,
          },
          null,
          2
        )
      );
      return;
    }

    case "state": {
      const sessionId = positionals[0] || String(flags.session || "");
      if (!sessionId) throw new Error("Missing sessionId");
      const data = await api(`/api/sessions/${encodeURIComponent(sessionId)}`);
      console.log(JSON.stringify(data, null, 2));
      return;
    }

    case "transcribe": {
      const audioFile = positionals[0];
      if (!audioFile) throw new Error("Missing <audioFile>");
      const absPath = path.resolve(audioFile);
      if (!fs.existsSync(absPath)) throw new Error(`File not found: ${absPath}`);

      let sessionId = typeof flags.session === "string" ? flags.session : "";
      if (!sessionId) {
        const created = await api<{ session: { id: string } }>("/api/sessions", {
          method: "POST",
          body: JSON.stringify({
            title: path.basename(absPath, path.extname(absPath)),
            autoMap: flags["no-map"] ? false : true,
          }),
        });
        sessionId = created.session.id;
      }

      const fileBuffer = fs.readFileSync(absPath);
      const form = new FormData();
      form.append("file", new Blob([fileBuffer]), path.basename(absPath));
      if (typeof flags.asr === "string") form.append("asrModel", flags.asr);
      if (typeof flags.diar === "string") {
        form.append("diarizationModel", flags.diar);
      }
      form.append("autoMap", String(flags["no-map"] ? false : true));

      const data = await api(
        `/api/sessions/${encodeURIComponent(sessionId)}/transcribe`,
        {
          method: "POST",
          body: form,
        }
      );
      console.log(JSON.stringify(data, null, 2));
      return;
    }

    case "youtube": {
      const ytUrl = positionals[0];
      if (!ytUrl) throw new Error("Missing <youtubeUrl>");
      let sessionId = typeof flags.session === "string" ? flags.session : "";
      if (!sessionId) {
        const created = await api<{ session: { id: string } }>("/api/sessions", {
          method: "POST",
          body: JSON.stringify({
            title: "YouTube Dialogue Map",
            autoMap: flags["no-map"] ? false : true,
          }),
        });
        sessionId = created.session.id;
      }
      const data = await api(
        `/api/sessions/${encodeURIComponent(sessionId)}/youtube`,
        {
          method: "POST",
          body: JSON.stringify({
            url: ytUrl,
            startSec: flags.start ? Number(flags.start) : undefined,
            durationSec: flags.duration ? Number(flags.duration) : undefined,
            asrModel: typeof flags.asr === "string" ? flags.asr : undefined,
            diarizationModel: typeof flags.diar === "string" ? flags.diar : undefined,
            autoMap: flags["no-map"] ? false : true,
          }),
        }
      );
      console.log(JSON.stringify(data, null, 2));
      return;
    }

    case "turn": {
      const sessionId = positionals[0] || String(flags.session || "");
      const text = typeof flags.text === "string" ? flags.text : "";
      if (!sessionId || !text) throw new Error("Usage: turn <sessionId> --text '...' [--speaker 1] [--name Maya]");
      const data = await api(
        `/api/sessions/${encodeURIComponent(sessionId)}/turns`,
        {
          method: "POST",
          body: JSON.stringify({
            turn: {
              speakerChannel: flags.speaker ? Number(flags.speaker) : 1,
              speakerName: typeof flags.name === "string" ? flags.name : undefined,
              text,
              source: "agent",
            },
            autoMap: flags["no-map"] ? false : true,
          }),
        }
      );
      console.log(JSON.stringify(data, null, 2));
      return;
    }

    case "op": {
      const sessionId = positionals[0] || String(flags.session || "");
      if (!sessionId) throw new Error("Missing sessionId");
      const rawJson =
        typeof flags.json === "string" ? flags.json : (await readStdin()).trim();
      if (!rawJson) throw new Error("Provide --json '<batch>' or pipe JSON on stdin");
      const payload = JSON.parse(rawJson);
      const data = await api(
        `/api/sessions/${encodeURIComponent(sessionId)}/map/ops`,
        {
          method: "POST",
          body: JSON.stringify(payload),
        }
      );
      console.log(JSON.stringify(data, null, 2));
      return;
    }

    case "analyze": {
      const sessionId = positionals[0] || String(flags.session || "");
      if (!sessionId) throw new Error("Missing sessionId");
      const data = await api(
        `/api/sessions/${encodeURIComponent(sessionId)}/map/analyze`,
        {
          method: "POST",
          body: JSON.stringify({ remapAll: Boolean(flags.remap) }),
        }
      );
      console.log(JSON.stringify(data, null, 2));
      return;
    }

    case "prompt": {
      const data = await api("/api/prompt/conklin");
      console.log(JSON.stringify(data, null, 2));
      return;
    }

    default:
      console.error(`Unknown command: ${cmd}`);
      printHelp();
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
