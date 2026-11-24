import { Suspense, useRef, useState } from "react";
import Bot from "lucide-react/icons/bot";
import ChevronDown from "lucide-react/icons/chevron-down";
import Download from "lucide-react/icons/download";
import FileAudio from "lucide-react/icons/file-headphone";
import Mic from "lucide-react/icons/mic";
import MicOff from "lucide-react/icons/mic-off";
import Play from "lucide-react/icons/play";
import Settings from "lucide-react/icons/settings";
import Square from "lucide-react/icons/square";
import Upload from "lucide-react/icons/upload";
import { YoutubeIcon as Youtube } from "@/components/YoutubeIcon";
import type { DialogueSession } from "@shared/schemas/models";
import type { SessionSummary } from "@/lib/api";
import { preloadOnIntent } from "@/components/panels";
import { Skeleton } from "@/components/Skeleton";
import { lazyWithPreload } from "@/lib/lazy";

// The session switcher only shows once opened; it loads on hover or focus
const { Component: SessionMenu, preloadOnIntent: preloadSessionMenu } = lazyWithPreload(() =>
  import("./SessionMenu").then((m) => m.SessionMenu)
);

/** The exporters only load when the user picks one from the Export menu. */
const loadExport = () => import("@/lib/export");

interface TopBarProps {
  /** The open session; undefined while it loads (title shows a skeleton, actions are disabled). */
  session?: DialogueSession;
  /** All sessions for the switcher; undefined while the list loads. */
  sessions?: SessionSummary[];
  isListening: boolean;
  micLevel: number;
  isTranscribing: boolean;
  isDemoRunning: boolean;
  speechMessage?: string;
  mapperBusy: boolean;
  mapperMessage?: string;
  onSelectSession: (id: string) => void;
  onCreateSession: () => void;
  onDeleteSession: (id: string) => void;
  onRenameSession: (title: string) => void;
  onToggleMic: () => void;
  onUploadAudio: (file: File) => void;
  onOpenYouTubeModal: () => void;
  onStopTranscribing: () => void;
  onToggleDemo: () => void;
  onOpenAgentModal: () => void;
  onOpenSettings: () => void;
}

export function TopBar({
  session,
  sessions,
  isListening,
  micLevel,
  isTranscribing,
  isDemoRunning,
  speechMessage,
  mapperBusy,
  mapperMessage,
  onSelectSession,
  onCreateSession,
  onDeleteSession,
  onRenameSession,
  onToggleMic,
  onUploadAudio,
  onOpenYouTubeModal,
  onStopTranscribing,
  onToggleDemo,
  onOpenAgentModal,
  onOpenSettings,
}: TopBarProps) {
  const [sessionsOpen, setSessionsOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const commitTitle = () => {
    setEditingTitle(false);
    const trimmed = titleDraft.trim();
    if (trimmed && session && trimmed !== session.title) {
      onRenameSession(trimmed);
    }
  };

  return (
    <header className="h-14 border-b border-stone-200/90 bg-white/95 backdrop-blur px-4 flex items-center justify-between gap-3 z-30 shrink-0">
      {/* Left: Brand + Session Selector */}
      <div className="flex items-center gap-3 min-w-0">
        <div className="flex items-center gap-2 shrink-0">
          <img
            src="/twig.png"
            alt="Dialogger"
            className="w-6 h-6 object-contain"
          />
          <span className="font-display font-semibold text-[17px] tracking-tight text-stone-900">
            Dialogger
          </span>
        </div>

        <span className="text-stone-300 select-none">/</span>

        {/* Session Dropdown + Inline Rename */}
        <div className="relative flex items-center gap-1 min-w-0">
          {editingTitle ? (
            <input
              autoFocus
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              onBlur={commitTitle}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitTitle();
                if (e.key === "Escape") setEditingTitle(false);
              }}
              className="text-sm font-medium text-stone-900 bg-stone-100 px-2 py-1 rounded-md border border-blue-400 outline-none w-64"
            />
          ) : (
            <button
              type="button"
              onDoubleClick={() => {
                if (!session) return;
                setTitleDraft(session.title);
                setEditingTitle(true);
              }}
              onClick={() => setSessionsOpen((v) => !v)}
              {...preloadSessionMenu}
              title="Click to switch sessions · Double-click to rename"
              className="flex items-center gap-1.5 text-sm font-medium text-stone-800 hover:text-stone-950 hover:bg-stone-100 px-2 py-1 rounded-md transition truncate max-w-[260px]"
            >
              {session ? (
                <span className="truncate">{session.title}</span>
              ) : (
                <Skeleton className="w-36 h-4" />
              )}
              <ChevronDown className="w-3.5 h-3.5 text-stone-400 shrink-0" />
            </button>
          )}

          {sessionsOpen && (
            <Suspense fallback={null}>
              <SessionMenu
                sessions={sessions}
                activeSessionId={session?.id}
                onSelect={onSelectSession}
                onCreate={onCreateSession}
                onDelete={onDeleteSession}
                onClose={() => setSessionsOpen(false)}
              />
            </Suspense>
          )}
        </div>

        {/* Live Status Pill */}
        {(isListening || isTranscribing || mapperBusy || speechMessage) && (
          <div className="hidden lg:flex items-center gap-2 px-2.5 py-1 rounded-full bg-stone-100 border border-stone-200 text-xs text-stone-700">
            <span
              className={`w-2 h-2 rounded-full ${
                isListening
                  ? "bg-rose-500 animate-pulse"
                  : isTranscribing || mapperBusy
                    ? "bg-blue-500 animate-pulse"
                    : "bg-emerald-500"
              }`}
            />
            <span className="truncate max-w-[260px]">
              {mapperBusy && mapperMessage
                ? mapperMessage
                : speechMessage || (isListening ? "Listening…" : "Transcribing…")}
            </span>
            {isTranscribing && (
              <button
                type="button"
                onClick={onStopTranscribing}
                className="ml-0.5 px-1.5 py-0.5 rounded-full bg-rose-100 text-rose-700 hover:bg-rose-200 text-[10px] font-semibold"
                title="Stop processing audio and keep everything mapped so far"
              >
                Stop
              </button>
            )}
          </div>
        )}
      </div>

      {/* Right: Primary Controls */}
      <div className="flex items-center gap-2 shrink-0">
        {/* Live Mic Button */}
        <button
          type="button"
          onClick={onToggleMic}
          disabled={!session}
          className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition border disabled:opacity-50 ${
            isListening
              ? "bg-rose-600 text-white border-rose-700 shadow-sm hover:bg-rose-700"
              : "bg-stone-900 text-white border-stone-900 hover:bg-stone-800"
          }`}
          title="Stream live microphone audio through Nemotron 3.5 ASR + Nemotron 3 Diarization"
        >
          {isListening ? (
            <>
              <MicOff className="w-3.5 h-3.5" />
              <span>Stop Mic</span>
              <span className="flex items-end gap-0.5 h-3 ml-0.5">
                {[0.3, 0.65, 1].map((t, idx) => (
                  <span
                    key={idx}
                    className="w-0.5 rounded-full bg-white/90 transition-all duration-75"
                    style={{
                      height: `${Math.max(25, Math.min(100, micLevel * 100 * (0.7 + t * 0.6)))}%`,
                    }}
                  />
                ))}
              </span>
            </>
          ) : (
            <>
              <Mic className="w-3.5 h-3.5" />
              <span>Live Mic</span>
            </>
          )}
        </button>

        {/* Audio File Upload */}
        <input
          ref={fileInputRef}
          type="file"
          accept="audio/*,video/*,.wav,.mp3,.m4a,.ogg,.flac,.webm,.mp4"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onUploadAudio(f);
            e.target.value = "";
          }}
        />
        <button
          type="button"
          disabled={!session || isTranscribing}
          onClick={() => fileInputRef.current?.click()}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-white border border-stone-200 text-stone-700 hover:bg-stone-50 hover:border-stone-300 transition disabled:opacity-50"
          title="Transcribe & diarize a local audio file with Parakeet TDT v3 + Nemotron 3 Diarization"
        >
          {isTranscribing ? (
            <FileAudio className="w-3.5 h-3.5 text-blue-600 animate-pulse" />
          ) : (
            <Upload className="w-3.5 h-3.5 text-stone-500" />
          )}
          <span className="hidden sm:inline">
            {isTranscribing ? "Diarizing…" : "Audio File"}
          </span>
        </button>

        {/* YouTube URL Import */}
        <button
          type="button"
          disabled={!session || isTranscribing}
          onClick={onOpenYouTubeModal}
          {...preloadOnIntent("youtube")}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-white border border-stone-200 text-stone-700 hover:bg-rose-50 hover:border-rose-200 hover:text-rose-800 transition disabled:opacity-50"
          title="Paste a YouTube link to download audio, diarize locally, and map live"
        >
          <Youtube className="w-3.5 h-3.5 text-rose-600" />
          <span className="hidden sm:inline">YouTube</span>
        </button>

        {/* Live Demo Toggle */}
        <button
          type="button"
          onClick={onToggleDemo}
          disabled={!session}
          className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition disabled:opacity-50 ${
            isDemoRunning
              ? "bg-amber-50 border-amber-300 text-amber-800 hover:bg-amber-100"
              : "bg-white border-stone-200 text-stone-700 hover:bg-stone-50"
          }`}
          title="Replay a live multi-speaker wicked problem conversation to see Conklin Dialogue Mapping in action"
        >
          {isDemoRunning ? (
            <>
              <Square className="w-3 h-3 fill-current" />
              <span className="hidden sm:inline">Stop Demo</span>
            </>
          ) : (
            <>
              <Play className="w-3 h-3 fill-current text-amber-600" />
              <span className="hidden sm:inline">Live Demo</span>
            </>
          )}
        </button>

        {/* Agent API Button */}
        <button
          type="button"
          onClick={onOpenAgentModal}
          disabled={!session}
          {...preloadOnIntent("agent")}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-blue-50 border border-blue-200 text-blue-800 hover:bg-blue-100 transition disabled:opacity-50"
          title="Connect an AI agent or model to drive this live Dialogue Map"
        >
          <Bot className="w-3.5 h-3.5" />
          <span className="hidden md:inline">Agent API</span>
        </button>

        {/* Export Menu */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setExportOpen((v) => !v)}
            disabled={!session}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-white border border-stone-200 text-stone-700 hover:bg-stone-50 transition disabled:opacity-50"
            title="Export Dialogue Map"
          >
            <Download className="w-3.5 h-3.5 text-stone-500" />
            <span className="hidden xl:inline">Export</span>
          </button>
          {exportOpen && (
            <>
              <div
                className="fixed inset-0 z-30"
                onClick={() => setExportOpen(false)}
              />
              <div className="absolute right-0 top-10 w-52 bg-white border border-stone-200 rounded-xl shadow-lg py-1.5 z-40 text-xs">
                <button
                  type="button"
                  onClick={() => {
                    setExportOpen(false);
                    if (session) void loadExport().then((m) => m.exportMapAsSvg(session));
                  }}
                  className="w-full text-left px-3 py-2 hover:bg-stone-50 text-stone-700 font-medium"
                >
                  Vector Graphic (.svg)
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setExportOpen(false);
                    if (session) void loadExport().then((m) => m.exportMapAsMarkdown(session));
                  }}
                  className="w-full text-left px-3 py-2 hover:bg-stone-50 text-stone-700 font-medium"
                >
                  Conklin IBIS Outline (.md)
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setExportOpen(false);
                    if (session) void loadExport().then((m) => m.exportSessionAsJson(session));
                  }}
                  className="w-full text-left px-3 py-2 hover:bg-stone-50 text-stone-700 font-medium"
                >
                  Full Session Bundle (.json)
                </button>
              </div>
            </>
          )}
        </div>

        {/* Settings */}
        <button
          type="button"
          onClick={onOpenSettings}
          disabled={!session}
          {...preloadOnIntent("settings")}
          className="p-1.5 rounded-lg bg-white border border-stone-200 text-stone-600 hover:bg-stone-50 hover:text-stone-900 transition disabled:opacity-50"
          title="Speech models (Nemotron 3 / Parakeet) & Dialogue Mapper settings"
        >
          <Settings className="w-4 h-4" />
        </button>
      </div>
    </header>
  );
}
