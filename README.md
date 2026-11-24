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

`ffmpeg` is used to normalize uploaded `.mp3`, `.m4a`, `.webm`, `.ogg`, `.flac`, or `.mp4` files into 16 kHz mono PCM16 WAV before inference.

### 2. Run Dialogger

```bash
pnpm install
pnpm build
pnpm start
```

Or run with hot reload during development:

```bash
pnpm dev
```

- Single-port production server: `http://127.0.0.1:4310` (loopback by default; set `DIALOGGER_HOST=0.0.0.0` with `DIALOGGER_API_KEY` for network access)
- Vite dev server: `http://localhost:4311` (proxies `/api` and `/ws` to `:4310`)

### 3. Optional LLM Dialogue Mapper (with 1Password)

Dialogger works **100% offline** out of the box with its deterministic Conklin heuristic mapper and 1-click Live Demo. To use an LLM model (OpenAI, xAI, Anthropic, OpenRouter, or local Ollama), either configure it in the **Settings** modal or launch via 1Password:

```bash
op run --env-file .env.1password -- pnpm start
```

## Driving Dialogger from an Agent or Model

Any external agent (Claude Code, Codex, Antigravity, custom script) can transcribe/diarize audio locally and stream live IBIS Dialogue Map updates to any open browser tab:

```bash
# Create a live session (prints sessionId and live viewer URL)
pnpm cli create --title "Architecture Review"

# Transcribe & diarize a local audio file with Parakeet TDT v3 + Nemotron 3 Diarization
pnpm cli transcribe ./meeting.wav --session <sessionId> --asr parakeet-tdt --diar nemotron-3-diarization

# Or import a public YouTube video (optional --start / --duration clip in seconds)
pnpm cli youtube "https://www.youtube.com/watch?v=..." --session <sessionId> --duration 120

# Read current diarized transcript & IBIS map state
pnpm cli state <sessionId>

# Push live Conklin IBIS operations (browsers update instantaneously via SSE)
pnpm cli op <sessionId> --json '{
  "actor": "agent",
  "summary": "Captured core question and initial proposal",
  "ops": [
    {"op": "add_node", "id": "q-1", "type": "question", "label": "How should we deploy local diarization?", "parentId": null},
    {"op": "add_node", "id": "i-1", "type": "idea", "label": "Run NeMo-Speech.cpp locally with Nemotron 3 Diarization", "parentId": "q-1", "relationLabel": "answers"}
  ]
}'
```

Or use the HTTP + SSE API directly:
- `GET /api/prompt/conklin` — Fetch the exact Jeffrey Conklin Dialogue Mapping prompt & schema
- `POST /api/sessions` — Create session
- `GET /api/sessions/:id` — Read full session JSON
- `GET /api/sessions/:id/events` — Real-time SSE stream
- `POST /api/sessions/:id/transcribe` — Transcribe + diarize uploaded multipart audio (`file` field)
- `POST /api/sessions/:id/turns` — Append diarized speaker turns
- `POST /api/sessions/:id/map/ops` — Apply incremental IBIS map operations
- `POST /api/sessions/:id/map/analyze` — Trigger built-in Conklin mapper on unmapped turns
- `WS /ws/sessions/:id/live` — Stream 16 kHz mono PCM16 audio frames to local `nemo-speech serve`

## License

[MIT](LICENSE)
