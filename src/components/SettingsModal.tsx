import { useEffect, useState } from "react";
import useSWRMutation from "swr/mutation";
import CheckCircle2 from "lucide-react/icons/circle-check";
import Cpu from "lucide-react/icons/cpu";
import Fingerprint from "lucide-react/icons/fingerprint-pattern";
import Play from "lucide-react/icons/play";
import RefreshCw from "lucide-react/icons/refresh-cw";
import Sparkles from "lucide-react/icons/sparkles";
import Trash2 from "lucide-react/icons/trash";
import X from "lucide-react/icons/x";
import XCircle from "lucide-react/icons/circle-x";
import type { DialogueSession } from "@shared/schemas/models";
import type { MapperConfigInfo } from "@shared/schemas/events";
import { api } from "@/lib/api";
import { keys, useMapperConfig, useSpeechStatus, useVoices } from "@/lib/queries";
import { Skeleton } from "@/components/Skeleton";

interface SettingsModalProps {
  session: DialogueSession;
  onClose: () => void;
  onUpdateSpeechConfig: (
    patch: Partial<DialogueSession["speechConfig"]>
  ) => Promise<void>;
}

export function SettingsModal({
  session,
  onClose,
  onUpdateSpeechConfig,
}: SettingsModalProps) {
  const speechStatusQuery = useSpeechStatus();
  const mapperConfigQuery = useMapperConfig();
  const voicesQuery = useVoices();
  // Each is undefined until it loads (skeletons stand in; see AGENTS.md)
  const speechStatus = speechStatusQuery.data;
  const mapperConfig = mapperConfigQuery.data;
  const voices = voicesQuery.data;
  const [actionError, setActionError] = useState<string | null>(null);
  const loadError =
    speechStatusQuery.error ?? mapperConfigQuery.error ?? voicesQuery.error;
  const error = actionError ?? (loadError ? loadError.message : null);
  // Mutation results go straight into the matching cache entry (populateCache); errors are
  // shown in the modal instead of thrown
  const onActionError = (err: Error) => setActionError(err.message);
  const mutationOptions = { revalidate: false, throwOnError: false, onError: onActionError };

  const [mode, setMode] = useState<MapperConfigInfo["mode"]>("llm");
  const [provider, setProvider] =
    useState<MapperConfigInfo["provider"]>("claude-cli");
  const [baseUrl, setBaseUrl] = useState("local://claude-cli");
  const [model, setModel] = useState("sonnet");
  const [apiKey, setApiKey] = useState("");

  // Fill the mapper form once the saved config loads (and again after a save)
  useEffect(() => {
    if (!mapperConfig) return;
    setMode(mapperConfig.mode);
    setProvider(mapperConfig.provider);
    setBaseUrl(mapperConfig.baseUrl);
    setModel(mapperConfig.model);
  }, [mapperConfig]);

  const refreshAll = () => {
    setActionError(null);
    void speechStatusQuery.mutate();
    void mapperConfigQuery.mutate();
    void voicesQuery.mutate();
  };

  const warmServer = useSWRMutation(
    keys.speechStatus,
    () =>
      api.startSpeechServer({
        asrModel: session.speechConfig.streamingAsrModel,
        diarModel: session.speechConfig.diarizationModel,
      }),
    { ...mutationOptions, populateCache: true }
  );

  const saveMapper = useSWRMutation(
    keys.mapperConfig,
    () =>
      api.updateMapperConfig({
        mode,
        provider: mode === "heuristic" ? "heuristic" : provider,
        baseUrl,
        model,
        apiKey: apiKey.trim() || undefined,
      }),
    { ...mutationOptions, populateCache: true, onSuccess: () => setApiKey("") }
  );

  const deleteVoice = useSWRMutation(
    keys.voices,
    (_key, { arg: id }: { arg: string }) => api.deleteVoice(id),
    { ...mutationOptions, populateCache: (res) => res.voices }
  );

  const handleSaveMapper = (e: React.FormEvent) => {
    e.preventDefault();
    setActionError(null);
    void saveMapper.trigger();
  };

  return (
    <div className="fixed inset-0 z-50 bg-stone-900/40 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white border border-stone-200 rounded-2xl shadow-xl max-w-2xl w-full max-h-[88vh] flex flex-col overflow-hidden">
        <div className="px-5 py-4 border-b border-stone-200 flex items-center justify-between">
          <div>
            <h2 className="font-display text-base font-semibold text-stone-900">
              Speech Runtime &amp; Dialogue Mapper Settings
            </h2>
            <p className="text-xs text-stone-500">
              Local NVIDIA NeMo-Speech.cpp (Nemotron 3 Diarization + Parakeet / Nemotron 3.5) and Conklin IBIS model config.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-stone-400 hover:bg-stone-100 hover:text-stone-700"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-6 text-xs">
          {error && (
            <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800">
              {error}
            </div>
          )}

          {/* Local Speech Runtime */}
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 font-semibold text-stone-800 text-sm">
                <Cpu className="w-4 h-4 text-emerald-600" />
                Local NVIDIA Speech Engine (NeMo-Speech.cpp)
              </div>
              <button
                type="button"
                onClick={refreshAll}
                className="inline-flex items-center gap-1 text-[11px] text-stone-500 hover:text-stone-900"
              >
                <RefreshCw className="w-3 h-3" /> Refresh
              </button>
            </div>

            {!speechStatus && !speechStatusQuery.error && (
              <Skeleton className="w-full h-24 rounded-xl" />
            )}
            {speechStatus && (
              <div className="p-3.5 rounded-xl bg-stone-50 border border-stone-200 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-3">
                    <StatusBadge
                      ok={speechStatus.installed}
                      label={
                        speechStatus.installed
                          ? `${speechStatus.version}`
                          : "nemo-speech not found"
                      }
                    />
                    <StatusBadge
                      ok={speechStatus.ffmpegInstalled}
                      label={speechStatus.ffmpegInstalled ? "ffmpeg ready" : "ffmpeg missing"}
                    />
                    <StatusBadge
                      ok={speechStatus.serverRunning}
                      label={
                        speechStatus.serverRunning
                          ? "Live server warm"
                          : "Live server idle"
                      }
                    />
                  </div>

                  {!speechStatus.serverRunning && speechStatus.installed && (
                    <button
                      type="button"
                      disabled={warmServer.isMutating}
                      onClick={() => {
                        setActionError(null);
                        void warmServer.trigger();
                      }}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-stone-900 text-white font-semibold hover:bg-stone-800 disabled:opacity-50"
                    >
                      <Play className="w-3 h-3 fill-current" />
                      {warmServer.isMutating ? "Starting…" : "Pre-warm Live Server"}
                    </button>
                  )}
                </div>

                {/* Model Selectors */}
                <div className="grid sm:grid-cols-3 gap-2.5 pt-1">
                  <div>
                    <label className="block text-[10px] font-semibold uppercase tracking-wider text-stone-500 mb-1">
                      Diarization Model
                    </label>
                    <select
                      value={session.speechConfig.diarizationModel}
                      onChange={(e) =>
                        void onUpdateSpeechConfig({
                          diarizationModel: e.target.value,
                        })
                      }
                      className="w-full bg-white border border-stone-200 rounded-lg px-2 py-1.5 text-xs font-medium text-stone-800"
                    >
                      <option value="nemotron-3-diarization">
                        Nemotron 3 Diarization (8 spk, overlap)
                      </option>
                      <option value="sortformer">
                        Sortformer v2 (4 spk)
                      </option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-[10px] font-semibold uppercase tracking-wider text-stone-500 mb-1">
                      File Transcription (Offline)
                    </label>
                    <select
                      value={session.speechConfig.offlineAsrModel}
                      onChange={(e) =>
                        void onUpdateSpeechConfig({
                          offlineAsrModel: e.target.value,
                        })
                      }
                      className="w-full bg-white border border-stone-200 rounded-lg px-2 py-1.5 text-xs font-medium text-stone-800"
                    >
                      <option value="parakeet-tdt">
                        Parakeet TDT 0.6B v3 (Recommended)
                      </option>
                      <option value="nemotron-3.5">
                        Nemotron 3.5 ASR 0.6B
                      </option>
                      <option value="parakeet-ctc">
                        Parakeet CTC 1.1B
                      </option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-[10px] font-semibold uppercase tracking-wider text-stone-500 mb-1">
                      Live Mic ASR (Streaming)
                    </label>
                    <select
                      value={session.speechConfig.streamingAsrModel}
                      onChange={(e) =>
                        void onUpdateSpeechConfig({
                          streamingAsrModel: e.target.value,
                        })
                      }
                      className="w-full bg-white border border-stone-200 rounded-lg px-2 py-1.5 text-xs font-medium text-stone-800"
                    >
                      <option value="nemotron-3.5">
                        Nemotron 3.5 Streaming 0.6B
                      </option>
                      <option value="nemotron-en">
                        Nemotron Speech EN Streaming 0.6B
                      </option>
                    </select>
                  </div>
                </div>

                {/* Cached Model Inventory */}
                <div className="pt-1">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-stone-400 mb-1.5">
                    Local Model Cache
                  </div>
                  <div className="grid sm:grid-cols-2 gap-1.5">
                    {speechStatus.cachedModels.map((m) => (
                      <div
                        key={m.name}
                        className="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-white border border-stone-200/80"
                      >
                        <div className="min-w-0">
                          <div className="font-mono-code font-medium text-stone-800 truncate">
                            {m.name}
                          </div>
                          <div className="text-[10px] text-stone-400 truncate">
                            {m.repo}
                          </div>
                        </div>
                        <span
                          className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full shrink-0 ${
                            m.cached
                              ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                              : "bg-stone-100 text-stone-500"
                          }`}
                        >
                          {m.cached ? "cached" : "auto-pull"}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </section>

          {/* Conklin Dialogue Mapper Model Settings */}
          <section className="space-y-3">
            <div className="flex items-center gap-2 font-semibold text-stone-800 text-sm">
              <Sparkles className="w-4 h-4 text-blue-600" />
              Conklin Dialogue Mapper Engine
            </div>

            <form
              onSubmit={handleSaveMapper}
              className="p-3.5 rounded-xl bg-stone-50 border border-stone-200 space-y-3"
            >
              <div className="grid grid-cols-3 gap-2">
                {(
                  [
                    ["llm", "LLM Model", "Uses OpenAI / xAI / Anthropic / Ollama"],
                    ["heuristic", "Local Offline", "Zero-key deterministic IBIS parser"],
                    ["agent-only", "Agent-Only", "External agent drives map via API"],
                  ] as const
                ).map(([id, label, desc]) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setMode(id)}
                    className={`p-2.5 rounded-xl border text-left transition ${
                      mode === id
                        ? "bg-white border-blue-500 ring-2 ring-blue-500/15"
                        : "bg-white/60 border-stone-200 hover:bg-white"
                    }`}
                  >
                    <div className="font-semibold text-stone-900">{label}</div>
                    <div className="text-[10px] text-stone-500 mt-0.5 leading-snug">
                      {desc}
                    </div>
                  </button>
                ))}
              </div>

              {mode === "llm" && (
                <div className="grid sm:grid-cols-2 gap-2.5 pt-1">
                  <div>
                    <label className="block text-[10px] font-semibold uppercase tracking-wider text-stone-500 mb-1">
                      Provider
                    </label>
                    <select
                      value={provider}
                      onChange={(e) => {
                        const next = e.target.value as MapperConfigInfo["provider"];
                        setProvider(next);
                        if (next === "claude-cli") {
                          setBaseUrl("local://claude-cli");
                          setModel("sonnet");
                        } else if (next === "codex-cli") {
                          setBaseUrl("local://codex-cli");
                          setModel("gpt-5.4");
                        } else if (next === "anthropic") {
                          setBaseUrl("https://api.anthropic.com/v1");
                          setModel("claude-sonnet-4-5");
                        } else {
                          setBaseUrl("https://api.openai.com/v1");
                          setModel("gpt-4.1-mini");
                        }
                      }}
                      className="w-full bg-white border border-stone-200 rounded-lg px-2.5 py-1.5"
                    >
                      <option value="claude-cli">
                        Claude Code CLI (Subscription · $0 API{mapperConfig?.claudeCliAvailable ? " ✓" : " — not found"})
                      </option>
                      <option value="codex-cli">
                        Codex CLI (Subscription · $0 API{mapperConfig?.codexCliAvailable ? " ✓" : " — not found"})
                      </option>
                      <option value="openai-compatible">
                        OpenAI-Compatible (OpenAI / xAI / Ollama)
                      </option>
                      <option value="anthropic">Anthropic Messages API</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-[10px] font-semibold uppercase tracking-wider text-stone-500 mb-1">
                      Model
                    </label>
                    <input
                      value={model}
                      onChange={(e) => setModel(e.target.value)}
                      placeholder={
                        provider === "claude-cli"
                          ? "sonnet / opus / haiku"
                          : provider === "codex-cli"
                            ? "gpt-5.4 / gpt-5-mini"
                            : "gpt-4.1-mini / grok-3-mini / llama3.2"
                      }
                      className="w-full bg-white border border-stone-200 rounded-lg px-2.5 py-1.5 font-mono-code"
                    />
                  </div>

                  {provider !== "claude-cli" && provider !== "codex-cli" && (
                    <>
                      <div>
                        <label className="block text-[10px] font-semibold uppercase tracking-wider text-stone-500 mb-1">
                          Base URL
                        </label>
                        <input
                          value={baseUrl}
                          onChange={(e) => setBaseUrl(e.target.value)}
                          placeholder="https://api.openai.com/v1"
                          className="w-full bg-white border border-stone-200 rounded-lg px-2.5 py-1.5 font-mono-code"
                        />
                      </div>

                      <div>
                        <label className="block text-[10px] font-semibold uppercase tracking-wider text-stone-500 mb-1">
                          Runtime API Key (memory only, never saved to disk)
                        </label>
                        <input
                          type="password"
                          value={apiKey}
                          onChange={(e) => setApiKey(e.target.value)}
                          placeholder={
                            mapperConfig?.hasApiKey
                              ? "•••••••• (configured via env / runtime)"
                              : "Optional if using local Ollama or env vars"
                          }
                          className="w-full bg-white border border-stone-200 rounded-lg px-2.5 py-1.5 font-mono-code"
                        />
                      </div>
                    </>
                  )}
                </div>
              )}

              <div className="flex items-center justify-between pt-1">
                <span className="text-[11px] text-stone-500">
                  Claude Code CLI &amp; Codex CLI use your existing subscriptions ($0 API cost).
                </span>
                <button
                  type="submit"
                  // Saving before the stored config loads would overwrite it with the form defaults
                  disabled={!mapperConfig || saveMapper.isMutating}
                  className="px-3.5 py-1.5 rounded-lg bg-blue-700 text-white font-semibold hover:bg-blue-800 disabled:opacity-50"
                >
                  {saveMapper.isMutating ? "Saving…" : "Save Mapper Config"}
                </button>
              </div>
            </form>
          </section>

          {/* Enrolled Speaker Voicebank (Nemotron 3 Diarization AOSC Seeds) */}
          <section className="space-y-2.5">
            <div className="flex items-center gap-2 font-semibold text-stone-800 text-sm">
              <Fingerprint className="w-4 h-4 text-indigo-600" />
              Enrolled Speaker Voices ({voices ? voices.length : <Skeleton className="w-3 h-3" />})
            </div>
            <div className="p-3.5 rounded-xl bg-stone-50 border border-stone-200 space-y-2">
              <p className="text-[11px] text-stone-500 leading-relaxed">
                Whenever you reassign a transcript turn to a named person (or rename a speaker), Dialogger saves a clean voice seed here and prepends it to <strong>Nemotron 3 Diarization</strong> so future windows and future recordings lock onto that speaker automatically.
              </p>
              {!voices ? (
                voicesQuery.error ? null : <Skeleton className="w-full h-8" />
              ) : voices.length === 0 ? (
                <p className="text-[11px] text-stone-400 italic">
                  No voices enrolled yet — click any speaker pill in a transcript to assign a name and enroll their voice.
                </p>
              ) : (
                <div className="grid sm:grid-cols-2 gap-1.5 pt-1">
                  {voices.map((v) => (
                    <div
                      key={v.id}
                      className="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-white border border-stone-200/80"
                    >
                      <div className="min-w-0">
                        <div className="font-semibold text-stone-800 truncate">
                          {v.name}
                        </div>
                        <div className="text-[10px] font-mono-code text-stone-400">
                          {v.durationSec.toFixed(1)}s seed · {v.sampleCount} sample{v.sampleCount === 1 ? "" : "s"}
                        </div>
                      </div>
                      <button
                        type="button"
                        disabled={deleteVoice.isMutating}
                        onClick={() => void deleteVoice.trigger(v.id)}
                        className="p-1 rounded-md text-stone-400 hover:text-rose-600 hover:bg-rose-50"
                        title="Remove enrolled voice"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 text-[11px] font-medium ${
        ok ? "text-emerald-700" : "text-stone-500"
      }`}
    >
      {ok ? (
        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
      ) : (
        <XCircle className="w-3.5 h-3.5 text-stone-400" />
      )}
      {label}
    </span>
  );
}
