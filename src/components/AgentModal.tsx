import { useState } from "react";
import { Bot, Check, Copy, Terminal, X } from "lucide-react";
import type { DialogueSession } from "@shared/schemas/models";

interface AgentModalProps {
  session: DialogueSession;
  onClose: () => void;
}

export function AgentModal({ session, onClose }: AgentModalProps) {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const origin = window.location.origin;

  const copy = (key: string, text: string) => {
    void navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1600);
  };

  const transcribeCmd = `curl -sS -X POST ${origin}/api/sessions/${session.id}/transcribe \\
  -F "file=@/path/to/meeting.wav" \\
  -F "asrModel=parakeet-tdt" \\
  -F "diarizationModel=nemotron-3-diarization" \\
  -F "autoMap=false"`;

  const opCmd = `curl -sS -X POST ${origin}/api/sessions/${session.id}/map/ops \\
  -H "Content-Type: application/json" \\
  -d '{
    "actor": "agent",
    "summary": "Mapped initial question and proposal",
    "ops": [
      {"op": "add_node", "id": "q-1", "type": "question", "label": "How should we structure local diarization?", "parentId": null},
      {"op": "add_node", "id": "i-1", "type": "idea", "label": "Use Nemotron 3 Diarization + Parakeet TDT v3", "parentId": "q-1", "relationLabel": "answers"}
    ]
  }'`;

  const apiDocs = `# Interactive API docs (try every endpoint in the browser):
${origin}/_swagger

# Machine-readable OpenAPI spec for agents and client generators:
curl -sS ${origin}/_openapi.json

# Read current diarized transcript + IBIS map state:
curl -sS ${origin}/api/sessions/${session.id}`;

  const agentPrompt = `You are driving a live Jeffrey Conklin Dialogue Map in Dialogger.
Live Viewer URL: ${origin}/?session=${session.id}
Session ID: ${session.id}
Full API spec (OpenAPI 3.1): ${origin}/_openapi.json

Workflow:
1. If given an audio file, upload it to transcribe & diarize locally with NVIDIA Parakeet TDT v3 + Nemotron 3 Diarization:
   POST ${origin}/api/sessions/${session.id}/transcribe  (multipart/form-data: file=@<path>, asrModel=parakeet-tdt, diarizationModel=nemotron-3-diarization, autoMap=false)
2. Read the diarized turns & current map:
   GET ${origin}/api/sessions/${session.id}
3. Read the exact Conklin IBIS prompt & rules:
   GET ${origin}/api/prompt/conklin
4. Emit incremental IBIS operations live (browsers update immediately via SSE):
   POST ${origin}/api/sessions/${session.id}/map/ops
   Allowed ops: add_node, update_node, move_node, delete_node, add_cross_link, remove_cross_link, rename_speaker, set_title.
   Node types: question (?), idea (💡), pro (+), con (−), decision (✓), note (i).
   Always surface implicit Questions before attaching Ideas, keep labels crisp (5–15 words), attach turnIds/speakerIds for provenance, and only mark Decision when speakers explicitly agree.`;

  return (
    <div className="fixed inset-0 z-50 bg-stone-900/40 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white border border-stone-200 rounded-2xl shadow-xl max-w-2xl w-full max-h-[88vh] flex flex-col overflow-hidden">
        <div className="px-5 py-4 border-b border-stone-200 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-50 border border-blue-200 flex items-center justify-center text-blue-700">
              <Bot className="w-4 h-4" />
            </div>
            <div>
              <h2 className="font-display text-base font-semibold text-stone-900">
                Agent &amp; Model Live API
              </h2>
              <p className="text-xs text-stone-500">
                Any agent or model can transcribe, diarize, and live-drive this Dialogue Map via HTTP + SSE.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-stone-400 hover:bg-stone-100 hover:text-stone-700"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4 text-xs">
          {/* Session ID + Copy Ready Agent Prompt */}
          <div className="p-3.5 rounded-xl bg-blue-50/70 border border-blue-200/80 flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-blue-700">
                Active Live Session
              </div>
              <div className="font-mono-code text-sm font-semibold text-blue-950">
                {session.id}
              </div>
            </div>
            <button
              type="button"
              onClick={() => copy("prompt", agentPrompt)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-700 text-white font-semibold hover:bg-blue-800 transition"
            >
              {copiedKey === "prompt" ? (
                <>
                  <Check className="w-3.5 h-3.5" /> Copied Agent Prompt
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" /> Copy Ready-to-Paste Agent Prompt
                </>
              )}
            </button>
          </div>

          <CodeBlock
            title="1. Transcribe & Diarize Locally (Parakeet TDT v3 + Nemotron 3 Diarization)"
            code={transcribeCmd}
            copied={copiedKey === "transcribe"}
            onCopy={() => copy("transcribe", transcribeCmd)}
          />

          <CodeBlock
            title="2. Push Live Conklin IBIS Map Operations (updates canvas instantly via SSE)"
            code={opCmd}
            copied={copiedKey === "ops"}
            onCopy={() => copy("ops", opCmd)}
          />

          <CodeBlock
            title="3. API Reference (Swagger UI + OpenAPI)"
            icon={<Terminal className="w-3.5 h-3.5 text-stone-400" />}
            code={apiDocs}
            copied={copiedKey === "api"}
            onCopy={() => copy("api", apiDocs)}
          />
        </div>
      </div>
    </div>
  );
}

function CodeBlock({
  title,
  icon,
  code,
  copied,
  onCopy,
}: {
  title: string;
  icon?: React.ReactNode;
  code: string;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="inline-flex items-center gap-1.5 font-semibold text-stone-700">
          {icon}
          {title}
        </span>
        <button
          type="button"
          onClick={onCopy}
          className="inline-flex items-center gap-1 text-[11px] font-medium text-stone-500 hover:text-stone-900"
        >
          {copied ? (
            <>
              <Check className="w-3 h-3 text-emerald-600" /> Copied
            </>
          ) : (
            <>
              <Copy className="w-3 h-3" /> Copy
            </>
          )}
        </button>
      </div>
      <pre className="p-3 rounded-xl bg-stone-950 text-stone-100 font-mono-code text-[11px] leading-relaxed overflow-x-auto">
        {code}
      </pre>
    </div>
  );
}
