import type { IBISMapOp } from "./schemas/models";

export interface DemoBeat {
  speakerChannel: number;
  speakerName: string;
  speakerRole: string;
  text: string;
  startSec: number;
  endSec: number;
  overlap?: boolean;
  overlapWithChannels?: number[];
  /**
   * Authentic Jeffrey Conklin IBIS ops produced as this turn arrives.
   * When an LLM is configured, live analysis can run too; this also makes
   * the 1-click Demo instantaneous and deterministic even completely offline.
   */
  ops: IBISMapOp[];
  activitySummary: string;
}

export const WICKED_PROBLEM_DEMO_TITLE =
  "Local-First AI Meeting Memory — Architecture Review";

export const WICKED_PROBLEM_DEMO_BEATS: DemoBeat[] = [
  {
    speakerChannel: 1,
    speakerName: "Maya",
    speakerRole: "Product Lead",
    text: "Alright everyone, let's tackle the big question today: how should we run transcription and speaker diarization for sensitive customer meetings without blowing our latency budget?",
    startSec: 0.4,
    endSec: 9.8,
    ops: [
      {
        op: "rename_speaker",
        speakerId: "speaker_1",
        name: "Maya",
        role: "Product Lead",
      },
      {
        op: "add_node",
        id: "q-arch",
        type: "question",
        label: "How should we run transcription & diarization for sensitive meetings?",
        detail: "Must protect sensitive audio while staying fast enough for live shared display.",
        parentId: null,
      },
    ],
    activitySummary: "Captured root Question on sensitive meeting transcription & diarization",
  },
  {
    speakerChannel: 2,
    speakerName: "Devon",
    speakerRole: "ML Engineer",
    text: "I'd run everything locally on-device using NVIDIA's Nemotron 3 Diarization paired with Parakeet TDT or Nemotron 3.5 Streaming via NeMo-Speech.cpp. Zero audio ever leaves the room.",
    startSec: 10.2,
    endSec: 21.5,
    ops: [
      {
        op: "rename_speaker",
        speakerId: "speaker_2",
        name: "Devon",
        role: "ML Engineer",
      },
      {
        op: "add_node",
        id: "i-local",
        type: "idea",
        label: "Run local Nemotron 3 Diarization + Parakeet / Nemotron 3.5 ASR",
        parentId: "q-arch",
        relationLabel: "answers",
      },
      {
        op: "add_node",
        id: "p-privacy",
        type: "pro",
        label: "Raw meeting audio never leaves the local machine",
        parentId: "i-local",
        relationLabel: "supports",
      },
    ],
    activitySummary: "Added local NVIDIA speech stack Idea and privacy Pro",
  },
  {
    speakerChannel: 3,
    speakerName: "Priya",
    speakerRole: "Security & Compliance",
    text: "Huge plus on keeping raw audio local—enterprise legal teams will sign off in days instead of months. Also Nemotron 3 handles eight overlapping speakers natively.",
    startSec: 21.1,
    endSec: 30.8,
    overlap: true,
    overlapWithChannels: [2],
    ops: [
      {
        op: "rename_speaker",
        speakerId: "speaker_3",
        name: "Priya",
        role: "Security & Compliance",
      },
      {
        op: "add_node",
        id: "p-compliance",
        type: "pro",
        label: "Dramatically faster enterprise security & legal approval",
        parentId: "i-local",
        relationLabel: "supports",
      },
      {
        op: "add_node",
        id: "p-overlap",
        type: "pro",
        label: "Handles up to 8 speakers including overlapping crosstalk",
        parentId: "i-local",
        relationLabel: "supports",
      },
    ],
    activitySummary: "Added compliance and 8-speaker overlap Pros (overlapping turn)",
  },
  {
    speakerChannel: 4,
    speakerName: "Carlos",
    speakerRole: "Staff Frontend",
    text: "Hold on—my concern with pure local inference is older laptops without a discrete GPU. Won't CPU inference choke or eat the user's battery during an hour-long meeting?",
    startSec: 31.4,
    endSec: 40.9,
    ops: [
      {
        op: "rename_speaker",
        speakerId: "speaker_4",
        name: "Carlos",
        role: "Staff Frontend",
      },
      {
        op: "add_node",
        id: "c-cpu",
        type: "con",
        label: "Older CPU-only laptops may face thermal or battery strain",
        parentId: "i-local",
        relationLabel: "objects to",
      },
      {
        op: "add_node",
        id: "q-hardware",
        type: "question",
        label: "How fast is Q8_0 local inference on CPU-only laptops?",
        parentId: "c-cpu",
        relationLabel: "questions",
      },
    ],
    activitySummary: "Captured CPU/battery Con and surfaced follow-up Question",
  },
  {
    speakerChannel: 2,
    speakerName: "Devon",
    speakerRole: "ML Engineer",
    text: "Good question. With NeMo-Speech.cpp Q8_0 quantization, Nemotron 3.5 streams at roughly 6x faster than real time on a plain CPU, and Nemotron 3 Diarization is only 100M parameters—about 102 MB on disk.",
    startSec: 41.3,
    endSec: 53.0,
    ops: [
      {
        op: "add_node",
        id: "n-bench",
        type: "note",
        label: "Q8_0 Nemotron 3.5 runs ~6x real-time on CPU; Diarizer is ~102 MB",
        parentId: "q-hardware",
        relationLabel: "context",
      },
    ],
    activitySummary: "Anchored benchmark data as a Note under the hardware Question",
  },
  {
    speakerChannel: 4,
    speakerName: "Carlos",
    speakerRole: "Staff Frontend",
    text: "Alternatively, we could offer a hybrid mode: cloud APIs by default for thin clients, and local models as an opt-in enterprise toggle.",
    startSec: 53.6,
    endSec: 61.9,
    ops: [
      {
        op: "add_node",
        id: "i-hybrid",
        type: "idea",
        label: "Hybrid: cloud ASR by default, local models as enterprise toggle",
        parentId: "q-arch",
        relationLabel: "answers",
      },
      {
        op: "add_node",
        id: "p-thin",
        type: "pro",
        label: "Works immediately on thin clients with zero model downloads",
        parentId: "i-hybrid",
        relationLabel: "supports",
      },
    ],
    activitySummary: "Added competing Hybrid Idea and zero-download Pro",
  },
  {
    speakerChannel: 3,
    speakerName: "Priya",
    speakerRole: "Security & Compliance",
    text: "If cloud is the default, people will accidentally stream confidential calls before flipping the toggle—and we have to maintain two totally separate diarization pipelines.",
    startSec: 62.2,
    endSec: 71.5,
    ops: [
      {
        op: "add_node",
        id: "c-accidental",
        type: "con",
        label: "Risk of accidental cloud upload of confidential calls",
        parentId: "i-hybrid",
        relationLabel: "objects to",
      },
      {
        op: "add_node",
        id: "c-maint",
        type: "con",
        label: "Doubles pipeline maintenance across two speech stacks",
        parentId: "i-hybrid",
        relationLabel: "objects to",
      },
    ],
    activitySummary: "Added two Cons against Hybrid default (leak risk & maintenance)",
  },
  {
    speakerChannel: 1,
    speakerName: "Maya",
    speakerRole: "Product Lead",
    text: "Let's also think about the dialogue mapping layer itself. Should the app only run its own built-in LLM mapper, or should external agents be able to drive the live map too?",
    startSec: 72.1,
    endSec: 82.0,
    ops: [
      {
        op: "add_node",
        id: "q-agent",
        type: "question",
        label: "Should external agents also be able to drive the live map?",
        parentId: "q-arch",
        relationLabel: "sub-question",
      },
    ],
    activitySummary: "Branched new sub-Question on external agent integration",
  },
  {
    speakerChannel: 4,
    speakerName: "Carlos",
    speakerRole: "Staff Frontend",
    text: "Definitely expose a clean HTTP + SSE session API! Then any coding agent or model can push diarized transcripts and emit incremental IBIS node patches while everyone watches the map evolve live.",
    startSec: 81.6,
    endSec: 93.4,
    overlap: true,
    overlapWithChannels: [1],
    ops: [
      {
        op: "add_node",
        id: "i-api",
        type: "idea",
        label: "Expose live HTTP + SSE API for both built-in models & external agents",
        parentId: "q-agent",
        relationLabel: "answers",
      },
      {
        op: "add_node",
        id: "p-composable",
        type: "pro",
        label: "Any model or agent can transcribe, diarize, and patch the live map",
        parentId: "i-api",
        relationLabel: "supports",
      },
      {
        op: "add_cross_link",
        id: "xl-1",
        fromId: "i-api",
        toId: "i-local",
        kind: "depends_on",
        label: "uses local speech engine",
      },
    ],
    activitySummary: "Added open Agent API Idea and linked dependency to local speech stack",
  },
  {
    speakerChannel: 1,
    speakerName: "Maya",
    speakerRole: "Product Lead",
    text: "Sounds like we're aligned. Let's commit to local-first speech with Nemotron 3 Diarization + Nemotron 3.5 / Parakeet TDT as the default, and ship the live Agent + Model IBIS API together. Any objections?",
    startSec: 94.0,
    endSec: 105.6,
    ops: [],
    activitySummary: "Maya checked for consensus on local-first speech & Agent API",
  },
  {
    speakerChannel: 2,
    speakerName: "Devon",
    speakerRole: "ML Engineer",
    text: "None from me—ship it. Parakeet TDT v3 for offline uploads and Nemotron 3.5 for live streaming gives us the best of both worlds.",
    startSec: 105.9,
    endSec: 113.2,
    ops: [
      {
        op: "add_node",
        id: "d-local",
        type: "decision",
        label: "Adopt local Nemotron 3 Diarization + Nemotron 3.5 (live) & Parakeet TDT v3 (file)",
        parentId: "i-local",
        relationLabel: "decides",
      },
      {
        op: "add_node",
        id: "d-api",
        type: "decision",
        label: "Ship unified HTTP + SSE IBIS API for both built-in models & external agents",
        parentId: "i-api",
        relationLabel: "decides",
      },
    ],
    activitySummary: "Recorded two Decisions after explicit group consensus",
  },
];
