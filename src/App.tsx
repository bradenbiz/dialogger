import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type DialogueSession,
  type HostContextCategory,
  type IBISNodeType,
  type TranscriptTurn,
} from "@shared/schemas/models";
import { computeConklinStats, IBIS_NODE_META } from "@shared/ibis";
import { api } from "@/lib/api";
import {
  applySessionEvent,
  cacheSession,
  invalidateSessions,
  isUnauthorized,
  useSession,
  useSessions,
} from "@/lib/queries";
import type { LiveMicController } from "@/lib/audio-capture";
import { TopBar } from "@/components/TopBar";
import {
  ConklinMetrics,
  type FacilitationLens,
} from "@/components/ConklinMetrics";
import { HostContextBar } from "@/components/HostContextBar";
import { TranscriptPanel, TranscriptPanelSkeleton } from "@/components/TranscriptPanel";
import {
  DialogueMapCanvas,
  DialogueMapCanvasPlaceholder,
} from "@/components/DialogueMapCanvas";
import { NodeInspector } from "@/components/NodeInspector";
import { AgentModal, SettingsModal, SignInScreen, YouTubeModal } from "@/components/panels";
import { closePanel, openPanel, useUrlState } from "@/lib/url-state";

export function App() {
  const [url, setUrl] = useUrlState();

  // Server state lives in the SWR cache; the open session's live SSE stream
  // writes into it (applySessionEvent), so `session` is always the cached copy.
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const sessionsQuery = useSessions();
  const sessions = sessionsQuery.data;
  const sessionQuery = useSession(activeSessionId);
  const session = sessionQuery.data;
  // Still showing the previous session while the newly selected one loads (keepPreviousData).
  // Compared by id, not isLoading: the live stream's snapshot can fill the cache first.
  const isSwitching = session !== undefined && session.id !== activeSessionId;
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [highlightedNodeIds, setHighlightedNodeIds] = useState<Set<string>>(
    new Set()
  );
  const [recentNodeIds, setRecentNodeIds] = useState<Set<string>>(new Set());
  const [lens, setLens] = useState<FacilitationLens>("all");
  const [activeSpeakerFilter, setActiveSpeakerFilter] = useState<string | null>(
    null
  );

  const [partialText, setPartialText] = useState("");
  const [isListening, setIsListening] = useState(false);
  const [micLevel, setMicLevel] = useState(0);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isDemoRunning, setIsDemoRunning] = useState(false);
  const [speechMessage, setSpeechMessage] = useState<string | undefined>();
  const [mapperBusy, setMapperBusy] = useState(false);
  const [mapperMessage, setMapperMessage] = useState<string | undefined>();
  const [toastError, setToastError] = useState<string | null>(null);

  const [playingTurnId, setPlayingTurnId] = useState<string | null>(null);
  const [seekRequest, setSeekRequest] = useState<{ sec: number; nonce: number } | null>(null);
  const authRequired =
    isUnauthorized(sessionsQuery.error) || isUnauthorized(sessionQuery.error);

  const micRef = useRef<LiveMicController | null>(null);
  const uploadInputRef = useRef<HTMLInputElement>(null);

  const showError = useCallback((msg: string) => {
    setToastError(msg);
    setTimeout(() => {
      setToastError((prev) => (prev === msg ? null : prev));
    }, 6500);
  }, []);

  /** Shows a session the server just returned (cache it, then make it the open one). */
  const showSession = useCallback((next: DialogueSession) => {
    cacheSession(next);
    setActiveSessionId(next.id);
  }, []);

  // Bootstrap once the session list loads: honor ?session=<id>, else open the latest,
  // else create a first session.
  useEffect(() => {
    if (activeSessionId || !sessionsQuery.data) return;
    const list = sessionsQuery.data;
    const urlId = new URLSearchParams(window.location.search).get("session");
    const targetId =
      (urlId && list.find((s) => s.id === urlId)?.id) || list[0]?.id;
    if (targetId) {
      setActiveSessionId(targetId);
      return;
    }
    let active = true;
    void api
      .createSession({ title: "New Dialogue Map" })
      .then(({ session: created }) => {
        if (!active) return;
        showSession(created);
        void invalidateSessions();
      })
      .catch((err) => showError(err instanceof Error ? err.message : String(err)));
    return () => {
      active = false;
    };
  }, [activeSessionId, sessionsQuery.data, showSession, showError]);

  // A failed load keeps the previous session as `data` (keepPreviousData), which would leave
  // the switching overlay up for good: go back to the session still on screen instead.
  useEffect(() => {
    const err = sessionQuery.error;
    if (!err || isUnauthorized(err)) return;
    showError(err.message);
    if (session && session.id !== activeSessionId) {
      setUrl({ session: session.id }, { replace: true });
      setActiveSessionId(session.id);
      void invalidateSessions();
    }
  }, [sessionQuery.error, showError]);

  // Keep ?session= in step with the open session. Switching sessions adds a history entry,
  // so Back/Forward move between them; the first sync (no or stale id in the URL) replaces.
  useEffect(() => {
    if (!activeSessionId || url.session === activeSessionId) return;
    setUrl({ session: activeSessionId }, { replace: !url.session });
  }, [activeSessionId]);

  // Back/Forward (or an edited URL) changed ?session=: open that session.
  useEffect(() => {
    if (!activeSessionId || !url.session || url.session === activeSessionId) return;
    if (sessions?.some((s) => s.id === url.session)) setActiveSessionId(url.session);
    // Unknown id: point the URL back at the session that's open
    else setUrl({ session: activeSessionId }, { replace: true });
  }, [url.session]);

  // Live SSE Subscription for the active session
  useEffect(() => {
    if (!activeSessionId) return;
    const sessionId = activeSessionId;

    const unsubscribe = api.subscribeToSession(sessionId, (evt) => {
      // Session data goes into the query cache; UI-only side effects are handled here.
      applySessionEvent(sessionId, evt);
      switch (evt.type) {
        case "transcript.partial":
          setPartialText(evt.text);
          break;

        case "transcript.turn":
        case "transcript.turns_batch":
          setPartialText("");
          break;

        case "map.updated":
          if (evt.affectedNodeIds.length > 0) {
            setRecentNodeIds(new Set(evt.affectedNodeIds));
            setTimeout(() => setRecentNodeIds(new Set()), 1500);
          }
          break;

        case "mapper.status":
          setMapperBusy(evt.status === "analyzing");
          setMapperMessage(evt.message);
          if (evt.status === "error" && evt.message) showError(evt.message);
          break;

        case "speech.status":
          setIsTranscribing(evt.state === "transcribing");
          setSpeechMessage(evt.message);
          if (evt.state === "idle") {
            setIsDemoRunning(false);
          }
          if (evt.state === "error" && evt.message) {
            showError(evt.message);
          }
          break;
      }
    });

    return () => {
      unsubscribe();
    };
  }, [activeSessionId, showError]);

  const stats = useMemo(
    () =>
      session ? computeConklinStats(session.nodes, session.turns) : undefined,
    [session]
  );

  const selectedNode = useMemo(
    () => session?.nodes.find((n) => n.id === selectedNodeId) || null,
    [session?.nodes, selectedNodeId]
  );

  const highlightedTurnIds = useMemo(() => {
    if (!selectedNode) return new Set<string>();
    return new Set(selectedNode.turnIds);
  }, [selectedNode]);

  // Actions
  const handleSelectSession = async (id: string) => {
    micRef.current?.stop();
    micRef.current = null;
    setIsListening(false);
    setSelectedNodeId(null);
    setHighlightedNodeIds(new Set());
    setActiveSpeakerFilter(null);
    setLens("all");
    setActiveSessionId(id);
  };

  const handleCreateSession = async () => {
    micRef.current?.stop();
    micRef.current = null;
    setIsListening(false);
    const { session: created } = await api.createSession({
      title: "New Dialogue Map",
    });
    showSession(created);
    setSelectedNodeId(null);
    await invalidateSessions();
  };

  const handleDeleteSession = async (id: string) => {
    await api.deleteSession(id);
    const remaining = await invalidateSessions();
    if (session?.id === id && remaining?.[0]) {
      await handleSelectSession(remaining[0].id);
    }
  };

  const handleToggleMic = async () => {
    if (!session) return;
    if (isListening) {
      micRef.current?.stop();
      micRef.current = null;
      setIsListening(false);
      return;
    }

    try {
      setIsListening(true);
      // Mic capture (AudioWorklet + WebSocket) only loads the first time the mic is turned on.
      const { startLiveMicCapture } = await import("@/lib/audio-capture");
      const controller = await startLiveMicCapture(session.id, {
        onLevel: setMicLevel,
        onStatus: setSpeechMessage,
        onError: (msg) => showError(msg),
        onClose: () => {
          setIsListening(false);
          setMicLevel(0);
          micRef.current = null;
        },
      });
      micRef.current = controller;
    } catch (err) {
      setIsListening(false);
      showError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleUploadAudio = async (file: File) => {
    if (!session) return;
    let targetSession = session;

    // Import into a fresh session by default whenever the current session already has audio or turns (S3)
    if (session.turns.length > 0 || session.audio) {
      const baseTitle = file.name.replace(/\.[^.]+$/, "").trim() || "Audio Upload";
      const { session: created } = await api.createSession({
        title: baseTitle,
        autoMap: session.autoMap,
      });
      targetSession = created;
      showSession(created);
      setSelectedNodeId(null);
      setHighlightedNodeIds(new Set());
      setActiveSpeakerFilter(null);
      setLens("all");
      await invalidateSessions();
    }

    setIsTranscribing(true);
    try {
      await api.transcribeFile(targetSession.id, file, {
        asrModel: targetSession.speechConfig.offlineAsrModel,
        diarizationModel: targetSession.speechConfig.diarizationModel,
        autoMap: targetSession.autoMap,
      });
      await invalidateSessions();
    } catch (err) {
      showError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsTranscribing(false);
    }
  };

  const handleImportYouTube = async (params: {
    url: string;
    startSec?: number;
    durationSec?: number;
    asrModel?: string;
    createNewSession?: boolean;
  }) => {
    if (!session) return;
    let targetSession = session;

    if (params.createNewSession) {
      const { session: created } = await api.createSession({
        title: "YouTube Dialogue Map",
        autoMap: session.autoMap,
      });
      targetSession = created;
      showSession(created);
      await invalidateSessions();
    }

    setIsTranscribing(true);
    setSelectedNodeId(null);
    setHighlightedNodeIds(new Set());
    setActiveSpeakerFilter(null);
    setLens("all");

    try {
      await api.importYouTube(targetSession.id, {
        url: params.url,
        startSec: params.startSec,
        durationSec: params.durationSec,
        asrModel: params.asrModel,
        diarizationModel: targetSession.speechConfig.diarizationModel,
        autoMap: targetSession.autoMap,
        clearExisting: !params.createNewSession && targetSession.turns.length > 0,
      });
      await invalidateSessions();
    } catch (err) {
      showError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsTranscribing(false);
    }
  };

  const handleTranscribeSavedAudio = async (startSec: number) => {
    if (!session) return;
    setIsTranscribing(true);
    setSelectedNodeId(null);
    setHighlightedNodeIds(new Set());
    try {
      await api.transcribeSavedAudio(session.id, {
        startSec,
        asrModel: session.speechConfig.streamingAsrModel || "nemotron-3.5",
        diarizationModel: session.speechConfig.diarizationModel,
        autoMap: session.autoMap,
        clearExisting: startSec === 0 && session.turns.length > 0,
      });
      await invalidateSessions();
    } catch (err) {
      showError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsTranscribing(false);
    }
  };

  const handleAudioTimeUpdate = useCallback(
    (sec: number, playing: boolean) => {
      if (!session || !playing) {
        setPlayingTurnId(null);
        return;
      }
      const active = session.turns.find(
        (t) => sec >= t.startSec - 0.15 && sec <= t.endSec + 0.35
      );
      if (active && active.id !== playingTurnId) {
        setPlayingTurnId(active.id);
        const linked = session.nodes
          .filter((n) => n.turnIds.includes(active.id))
          .map((n) => n.id);
        if (linked.length > 0) {
          setHighlightedNodeIds(new Set(linked));
        }
      }
    },
    [session, playingTurnId]
  );

  const handleToggleDemo = async () => {
    if (!session) return;
    if (isDemoRunning) {
      await api.stopDemo(session.id);
      setIsDemoRunning(false);
    } else {
      let targetSession = session;
      const hasRealContent =
        Boolean(session.audio) ||
        session.turns.some((t) => t.source !== "demo");
      if (hasRealContent) {
        const { session: created } = await api.createSession({
          title: "Live Demo",
        });
        targetSession = created;
        showSession(created);
        await invalidateSessions();
      }
      setSelectedNodeId(null);
      setHighlightedNodeIds(new Set());
      setLens("all");
      setIsDemoRunning(true);
      await api.startDemo(targetSession.id, { intervalMs: 1750 });
    }
  };

  const handleQuickAddChild = async (
    parentId: string | null,
    type: IBISNodeType
  ) => {
    if (!session) return;
    const defaultLabel = `New ${IBIS_NODE_META[type].shortName}${
      type === "question" ? "?" : ""
    }`;
    const res = await api.applyMapOps(session.id, {
      actor: "human",
      summary: `Added ${IBIS_NODE_META[type].shortName} node`,
      ops: [
        {
          op: "add_node",
          type,
          label: defaultLabel,
          parentId,
        },
      ],
    });
    if (res.affectedNodeIds[0]) {
      setSelectedNodeId(res.affectedNodeIds[0]);
    }
  };

  const handleSelectTurn = (turn: TranscriptTurn) => {
    if (!session) return;
    if (session.audio) {
      setSeekRequest({ sec: turn.startSec, nonce: Date.now() });
    }
    const linked = session.nodes
      .filter((n) => n.turnIds.includes(turn.id))
      .map((n) => n.id);
    if (linked.length > 0) {
      setHighlightedNodeIds(new Set(linked));
      setSelectedNodeId(linked[0]);
    } else {
      setHighlightedNodeIds(new Set());
    }
  };

  if (authRequired) {
    return (
      <Suspense fallback={<div className="w-screen h-screen bg-[#FAF9F6]" />}>
        <SignInScreen />
      </Suspense>
    );
  }

  return (
    <>
      {/* While switching, the previous session is still on screen: inert blocks mouse and
          keyboard so no action runs against it. The toast stays outside, so it can be dismissed. */}
      <div
        className={`w-screen h-screen flex flex-col overflow-hidden bg-[#FAF9F6] transition-opacity ${
          isSwitching ? "opacity-60" : ""
        }`}
        inert={isSwitching}
        aria-busy={isSwitching}
      >
        {/* Hidden input for empty-state upload CTA */}
        <input
          ref={uploadInputRef}
          type="file"
          accept="audio/*,video/*,.wav,.mp3,.m4a,.ogg,.flac,.webm,.mp4"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleUploadAudio(f);
            e.target.value = "";
          }}
        />

        <TopBar
          session={session}
          sessions={sessions}
          isListening={isListening}
          micLevel={micLevel}
          isTranscribing={isTranscribing}
          isDemoRunning={isDemoRunning}
          speechMessage={speechMessage}
          mapperBusy={mapperBusy}
          mapperMessage={mapperMessage}
          onSelectSession={(id) => void handleSelectSession(id)}
          onCreateSession={() => void handleCreateSession()}
          onDeleteSession={(id) => void handleDeleteSession(id)}
          onRenameSession={(title) => {
            if (session) void api.updateSession(session.id, { title });
          }}
          onToggleMic={() => void handleToggleMic()}
          onUploadAudio={(f) => void handleUploadAudio(f)}
          onOpenYouTubeModal={() => openPanel("youtube")}
          onStopTranscribing={() => {
            if (session) void api.stopTranscription(session.id);
          }}
          onToggleDemo={() => void handleToggleDemo()}
          onOpenAgentModal={() => openPanel("agent")}
          onOpenSettings={() => openPanel("settings")}
        />

        <ConklinMetrics
          stats={stats}
          lens={lens}
          onChangeLens={(next) => {
            setLens(next);
            setHighlightedNodeIds(new Set());
          }}
          onHighlightNodes={(ids) => {
            setHighlightedNodeIds(new Set(ids));
            if (ids[0]) setSelectedNodeId(ids[0]);
          }}
        />

        <div className="flex-1 flex min-h-0 overflow-hidden">
          {session ? (
            <TranscriptPanel
              session={session}
              partialText={partialText}
              highlightedTurnIds={highlightedTurnIds}
              playingTurnId={playingTurnId}
              seekRequest={seekRequest}
              activeSpeakerFilter={activeSpeakerFilter}
              mapperBusy={mapperBusy}
              isTranscribing={isTranscribing}
              onAudioTimeUpdate={handleAudioTimeUpdate}
              onTranscribeSavedAudio={(sec) => void handleTranscribeSavedAudio(sec)}
              onTrimAudio={async (params) => {
                try {
                  const { session: updated } = await api.trimSessionAudio(
                    session.id,
                    params
                  );
                  cacheSession(updated);
                  setSelectedNodeId(null);
                  setHighlightedNodeIds(new Set());
                  await invalidateSessions();
                } catch (err) {
                  showError(err instanceof Error ? err.message : String(err));
                }
              }}
              onStopTranscribing={() => void api.stopTranscription(session.id)}
              onSelectTurn={handleSelectTurn}
              onReassignTurnSpeaker={(turnId, patch) =>
                void api.updateTurnSpeaker(session.id, turnId, patch)
              }
              onFilterSpeaker={(spkId) => {
                setActiveSpeakerFilter(spkId);
                setHighlightedNodeIds(new Set());
              }}
              onRenameSpeaker={(spkId, name) =>
                void api.renameSpeaker(session.id, spkId, name)
              }
              onSubmitManualTurn={async (speakerChannel, text) => {
                await api.addTurn(
                  session.id,
                  { speakerChannel, text, source: "manual" },
                  session.autoMap
                );
              }}
              onToggleAutoMap={(autoMap) =>
                void api.updateSession(session.id, { autoMap })
              }
              onAnalyzeUnmapped={() => void api.analyzeMap(session.id, false)}
              onDropAudioFile={(f) => void handleUploadAudio(f)}
            />
          ) : (
            <TranscriptPanelSkeleton />
          )}

          <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">
            <HostContextBar
              items={session?.hostContext}
              speakers={session?.speakers}
              onAddContext={(category: HostContextCategory, summary: string) => {
                if (!session) return;
                void api.applyMapOps(session.id, {
                  actor: "human",
                  summary: `Added session ${category.replace(/_/g, " ")} context`,
                  ops: [{ op: "add_host_context", category, summary }],
                });
              }}
              onRemoveContext={(id: string) => {
                if (!session) return;
                void api.applyMapOps(session.id, {
                  actor: "human",
                  ops: [{ op: "remove_host_context", id }],
                });
              }}
              onFocusTurn={(turnId) => {
                const turn = session?.turns.find((t) => t.id === turnId);
                if (turn) handleSelectTurn(turn);
              }}
            />

            {session && stats ? (
              <DialogueMapCanvas
                session={session}
                stats={stats}
                lens={lens}
                activeSpeakerFilter={activeSpeakerFilter}
                selectedNodeId={selectedNodeId}
                highlightedNodeIds={highlightedNodeIds}
                recentNodeIds={recentNodeIds}
                onSelectNode={(id) => {
                  setSelectedNodeId(id);
                  if (!id) setHighlightedNodeIds(new Set());
                }}
                onQuickAddChild={(parentId, type) =>
                  void handleQuickAddChild(parentId, type)
                }
                onStartDemo={() => void handleToggleDemo()}
                onTriggerUpload={() => uploadInputRef.current?.click()}
                onOpenYouTube={() => openPanel("youtube")}
              />
            ) : (
              <DialogueMapCanvasPlaceholder />
            )}
          </div>

          <NodeInspector
            session={session}
            selectedNode={selectedNode}
            onClose={() => setSelectedNodeId(null)}
            onUpdateNode={(id, patch) => {
              if (!session) return;
              void api.applyMapOps(session.id, {
                actor: "human",
                ops: [{ op: "update_node", id, ...patch }],
              });
            }}
            onDeleteNode={(id) => {
              setSelectedNodeId(null);
              if (!session) return;
              void api.applyMapOps(session.id, {
                actor: "human",
                summary: "Removed node branch",
                ops: [{ op: "delete_node", id, cascade: true }],
              });
            }}
            onAddChild={(parentId, type, label) => {
              if (!session) return;
              void api.applyMapOps(session.id, {
                actor: "human",
                summary: `Added ${IBIS_NODE_META[type].shortName} node`,
                ops: [{ op: "add_node", parentId, type, label }],
              });
            }}
            onFocusTurn={(turnId) => {
              const turn = session?.turns.find((t) => t.id === turnId);
              if (turn) handleSelectTurn(turn);
            }}
            onSelectNode={(id) => setSelectedNodeId(id)}
          />
        </div>

        {/* Panels load on demand (see components/panels.tsx) */}
        <Suspense fallback={null}>
          {session && url.panel === "agent" && (
            <AgentModal session={session} onClose={closePanel} />
          )}

          {session && url.panel === "settings" && (
            <SettingsModal
              session={session}
              onClose={closePanel}
              onUpdateSpeechConfig={async (patch) => {
                const { session: updated } = await api.updateSession(session.id, {
                  speechConfig: patch,
                });
                cacheSession(updated);
              }}
            />
          )}

          {session && url.panel === "youtube" && (
            <YouTubeModal
              session={session}
              onClose={closePanel}
              onStartImport={(params) => handleImportYouTube(params)}
            />
          )}
        </Suspense>
      </div>

      {/* Error Toast */}
      {toastError && (
        <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-50 max-w-lg px-4 py-2.5 rounded-xl bg-rose-950 text-rose-50 text-xs font-medium shadow-lg border border-rose-800 flex items-center gap-3">
          <span>{toastError}</span>
          <button
            type="button"
            onClick={() => setToastError(null)}
            className="text-rose-300 hover:text-white font-bold"
            aria-label="Dismiss error"
          >
            ✕
          </button>
        </div>
      )}
    </>
  );
}
