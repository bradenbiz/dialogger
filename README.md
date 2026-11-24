# Dialogger

**Live local transcription, speaker diarization, and real-time IBIS Dialogue Mapping** grounded in Jeffrey Conklin's *Dialogue Mapping: Building Shared Understanding of Wicked Problems* (Wiley, 2005).

Dialogger lets either a **built-in model** or an **external AI agent** transcribe and diarize a multi-speaker conversation locally and evolve a shared **IBIS Dialogue Map** live in the browser over Server-Sent Events (SSE).

## Local NVIDIA Speech Stack

Powered by NVIDIA's native C++/ggml runtime [**NeMo-Speech.cpp**](https://github.com/NVIDIA/NeMo-Speech.cpp) (`nemo-speech`), running completely locally on CPU, Apple Silicon Metal, Vulkan, or CUDA:

| Role | Default Model | Hugging Face Repo | Why |
|---|---|---|---|
| **Local Diarization** | `nemotron-3-diarization` | [`nvidia/Nemotron-3-Diarization`](https://huggingface.co/nvidia/Nemotron-3-Diarization) | 100M-param streaming & offline Sortformer v3, up to **8 speakers**, handles **overlapping speech** (~102 MB Q8_0 GGUF) |
| **Offline File ASR** | `parakeet-tdt` | [`nvidia/parakeet-tdt-0.6b-v3`](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3) | NVIDIA Parakeet TDT 0.6B v3 — multilingual SOTA accuracy with word timestamps |
| **Live Streaming ASR** | `nemotron-3.5` | [`nvidia/nemotron-3.5-asr-streaming-0.6b`](https://huggingface.co/nvidia/nemotron-3.5-asr-streaming-0.6b) | Real-time 160 ms chunk streaming (~6× real-time even on CPU) paired with Nemotron 3 Diarization |

## Jeffrey Conklin's Dialogue Mapping (IBIS) Principles

- **6 canonical node types**: **Question (`?`)**, **Idea (`💡`)**, **Pro (`+`)**, **Con (`−`)**, **Decision (`✓`)**, and **Note (`i`)** laid out left-to-right with legal IBIS relationship labels (`answers`, `supports`, `objects to`, `questions`, `decides`, `context`) plus optional cross-links.
- **Surface implicit Questions**: proposals attach under an explicit framing Question rather than floating as orphan solutions.
- **Distill, don't stenograph**: crisp, neutral 5–15 word node labels with bidirectional **transcript provenance** (click any node to inspect verbatim diarized quotes & timestamps; click any turn to highlight its map nodes).
- **Facilitation Lens & Signals**: spotlight **Open Questions**, **Contested Ideas** (ideas with both Pros and Cons), **Decisions**, or individual speakers — with live Conklin facilitation nudges against premature convergence.
- **Incremental Spatial Stability**: updates arrive as minimal JSON patch operations (`add_node`, `update_node`, `move_node`, `delete_node`, `add_cross_link`, `rename_speaker`) so spatial memory stays intact during live meetings.

## Quickstart

### 1. Install `nemo-speech` (local NVIDIA speech runtime)

```bash
# Auto-detect backend (Metal on Apple Silicon, CUDA on modern NVIDIA GPUs, CPU otherwise)
curl -fsSL https://github.com/NVIDIA/NeMo-Speech.cpp/raw/main/scripts/install.sh | sh

# Or force CPU build (recommended on CPU-only hosts or older Maxwell/Kepler GPUs):
curl -fsSL https://github.com/NVIDIA/NeMo-Speech.cpp/raw/main/scripts/install.sh | sh -s -- --backend cpu --binary-only

# Optional: pre-download models ahead of time
nemo-speech pull nemotron-3-diarization
nemo-speech pull parakeet-tdt
nemo-speech pull nemotron-3.5
```

`ffmpeg` (which includes `ffprobe`) is used to normalize uploaded `.mp3`, `.m4a`, `.webm`, `.ogg`, `.flac`, or `.mp4` files into 16 kHz mono PCM16 WAV before inference.

**YouTube import** (optional) also needs [`yt-dlp`](https://github.com/yt-dlp/yt-dlp). It has to be a recent release (2025.11 or later), because those can use Node to solve YouTube's player challenges. Dialogger passes yt-dlp the Node binary the server runs on, so you don't need to install another JavaScript runtime.

```bash
# macOS
brew install ffmpeg yt-dlp

# Debian/Ubuntu
sudo apt install ffmpeg && pipx install yt-dlp
```

These must be on the `PATH` of the process running the Dialogger server. Restart the server after installing them.

> **Gotcha: `HTTP Error 403: Forbidden` means yt-dlp is out of date.** YouTube changes often, and a yt-dlp that is a few months old can still read video metadata but gets a 403 when it downloads the audio. Upgrade with `brew upgrade yt-dlp`, `pipx upgrade yt-dlp`, or `yt-dlp -U` (whichever matches how you installed it), then try again.

### 2. Run Dialogger

Dialogger is a single [Nitro](https://nitro.build) v3 app served through Vite. The web UI, REST API, SSE stream, and live-mic WebSocket all run on one port.

It needs **Node.js 22.4 or later**, which ships the global `WebSocket` the server uses. `pnpm install` stops with an error on older versions.

```bash
pnpm install
pnpm dev
```

For production:

```bash
pnpm build
pnpm start
```

- Both `pnpm dev` and `pnpm start` serve on `http://127.0.0.1:4310`. Change it with `DIALOGGER_PORT`.
- It binds to loopback by default. For network access, set `DIALOGGER_HOST=0.0.0.0` together with `DIALOGGER_API_KEY`.
- Interactive API docs (Swagger UI): `http://127.0.0.1:4310/_swagger`. The raw OpenAPI spec is at `/_openapi.json`. See [API Reference](#api-reference-swagger--openapi).

### 3. Optional LLM Dialogue Mapper (with 1Password)

Dialogger works **100% offline** out of the box with its deterministic Conklin heuristic mapper and 1-click Live Demo. To use an LLM model (OpenAI, xAI, Anthropic, OpenRouter, or local Ollama), either configure it in the **Settings** modal or launch via 1Password:

```bash
op run --env-file .env.1password -- pnpm start
```

## API Reference (Swagger / OpenAPI)

The server generates its API documentation automatically. Both `pnpm dev` and `pnpm start` serve it on the same port as the app:

| What | Path | Default URL |
|---|---|---|
| Swagger UI (browse and try every endpoint) | `/_swagger` | http://127.0.0.1:4310/_swagger |
| OpenAPI 3.1 spec (JSON, for agents and client generators) | `/_openapi.json` | http://127.0.0.1:4310/_openapi.json |

If you change `DIALOGGER_PORT` or `DIALOGGER_HOST`, the URLs change with it.

**What's documented:**
- **Every endpoint**, grouped by area: Sessions, Transcript, Transcription, Audio, Map, YouTube, Speech, Voices, Mapper, Demo, Auth, Health, and Live.
- **For each endpoint:** request body, success response, and error responses.
- **Long-running transcription endpoints** (`/transcribe`, `/audio/transcribe`, `/youtube`) return either their result or `{ "cancelled": true }` if the job was stopped or replaced.
- **The live event stream** (`GET /api/sessions/{id}/events`) is documented as `SessionEvent`, the set of JSON events it can send.
- **The live-mic WebSocket** (`/ws/sessions/{id}/live`) is listed with its message protocol.

**Errors.** Every non-2xx response is JSON in the form `{ "error": ... }`, where `error` is either:
- a message string, or
- for invalid request bodies, `{ "formErrors": [...], "fieldErrors": { "<field>": [...] } }`.

**Using "Try it out" with an API key.** The Swagger page and the spec are always public. When `DIALOGGER_API_KEY` is set, the `/api` requests that Swagger sends need authentication:
1. Open the Dialogger web UI in the same browser.
2. Sign in there. That sets a session cookie.
3. Use "Try it out" in Swagger; the cookie goes along with its requests.

Outside the browser, send `Authorization: Bearer <key>`.

**Where the docs come from.** The request and response shapes are Zod schemas in `shared/`:
- [`shared/schemas/contracts.ts`](shared/schemas/contracts.ts): request and response bodies for each endpoint
- [`shared/schemas/models.ts`](shared/schemas/models.ts): sessions, turns, speakers, map nodes, and map operations
- [`shared/schemas/events.ts`](shared/schemas/events.ts): live-stream events and status types
- [`shared/schemas/registry.ts`](shared/schemas/registry.ts): names the schemas and turns them into OpenAPI definitions

The server validates requests with these schemas, and the web client uses the same types. The Swagger definitions are generated from them when the spec is served, so the docs can't drift from what the server accepts.

**Documenting a new endpoint:**
1. Add the route file under `server/api/`.
2. Define its body schemas in `shared/schemas/contracts.ts` and give each one a name with `named("MyThing", ...)`.
3. In the route's `defineRouteMeta`, reference them as `#/components/schemas/MyThing`.

`pnpm test` fails if a route references a schema name that doesn't exist.

## Driving Dialogger from an Agent or Model

Any external agent (Claude Code, Codex, a custom script) can transcribe and diarize audio locally and stream live IBIS Dialogue Map updates to every open browser tab, using the HTTP API. Browse and try every endpoint in Swagger UI at `/_swagger`. Point agents at `/_openapi.json` for the machine-readable spec.

```bash
# Create a live session
curl -X POST http://127.0.0.1:4310/api/sessions \
  -H 'content-type: application/json' -d '{"title": "Architecture Review"}'

# Transcribe & diarize a local audio file with Parakeet TDT v3 + Nemotron 3 Diarization
curl -X POST http://127.0.0.1:4310/api/sessions/<sessionId>/transcribe \
  -F file=@meeting.wav -F asrModel=parakeet-tdt

# Or import a public YouTube video (optional startSec / durationSec clip)
curl -X POST http://127.0.0.1:4310/api/sessions/<sessionId>/youtube \
  -H 'content-type: application/json' \
  -d '{"url": "https://www.youtube.com/watch?v=...", "durationSec": 120}'

# Push live Conklin IBIS operations (browsers update instantly via SSE)
curl -X POST http://127.0.0.1:4310/api/sessions/<sessionId>/map/ops \
  -H 'content-type: application/json' -d '{
  "actor": "agent",
  "summary": "Captured core question and initial proposal",
  "ops": [
    {"op": "add_node", "id": "q-1", "type": "question", "label": "How should we deploy local diarization?", "parentId": null},
    {"op": "add_node", "id": "i-1", "type": "idea", "label": "Run NeMo-Speech.cpp locally with Nemotron 3 Diarization", "parentId": "q-1", "relationLabel": "answers"}
  ]
}'
```

When `DIALOGGER_API_KEY` is set, add `-H 'Authorization: Bearer <key>'` to each request.

Key endpoints:
- `GET /api/prompt/conklin` — The exact Jeffrey Conklin Dialogue Mapping prompt and schema
- `GET /api/sessions/:id` — Full session JSON (transcript + map)
- `GET /api/sessions/:id/events` — Real-time SSE stream
- `POST /api/sessions/:id/turns` — Append diarized speaker turns
- `POST /api/sessions/:id/map/analyze` — Run the built-in Conklin mapper on unmapped turns
- `WS /ws/sessions/:id/live` — Stream 16 kHz mono PCM16 audio frames to local `nemo-speech serve`

## License

[MIT](LICENSE)
