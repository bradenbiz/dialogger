import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type DialogueSession,
  type HostContextCategory,
  type IBISNodeType,
  type TranscriptTurn,
} from "@shared/schemas/models";
import { computeConklinStats, IBIS_NODE_META } from "@shared/ibis";
import { api, ApiError, type SessionSummary } from "@/lib/api";
import type { LiveMicController } from "@/lib/audio-capture";
import { TopBar } from "@/components/TopBar";
import {
  ConklinMetrics,
  type FacilitationLens,
} from "@/components/ConklinMetrics";
import { HostContextBar } from "@/components/HostContextBar";
import { TranscriptPanel } from "@/components/TranscriptPanel";
import { DialogueMapCanvas } from "@/components/DialogueMapCanvas";
import { NodeInspector } from "@/components/NodeInspector";
import { AgentModal, SettingsModal, YouTubeModal } from "@/components/panels";
import { closePanel, openPanel, useUrlState } from "@/lib/url-state";

export function App() {
  const [url, setUrl] = useUrlState();

  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [session, setSession] = useState<DialogueSession | null>(null);
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
  const [authRequired, setAuthRequired] = useState(false);
  const [authTokenInput, setAuthTokenInput] = useState("");
  const [authError, setAuthError] = useState<string | null>(null);
  const [authNonce, setAuthNonce] = useState(0);

  const micRef = useRef<LiveMicController | null>(null);
  const uploadInputRef = useRef<HTMLInputElement>(null);

  const showError = useCallback((msg: string) => {
    setToastError(msg);
    setTimeout(() => {
      setToastError((prev) => (prev === msg ? null : prev));
    }, 6500);
  }, []);

  const refreshSessionsList = useCallback(async () => {
    try {
      const { sessions: list } = await api.listSessions();
      setSessions(list);
      return list;
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setAuthRequired(true);
        throw err;
      }
      return [];
    }
  }, []);

  // Bootstrap: honor ?session=<id> URL param or load latest session
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const list = await refreshSessionsList();
        const urlId = new URLSearchParams(window.location.search).get("session");
        const targetId =
          (urlId && list.find((s) => s.id === urlId)?.id) || list[0]?.id;

        if (targetId) {
          const { session: loaded } = await api.getSession(targetId);
          if (active) setSession(loaded);
        } else {
          const { session: created } = await api.createSession({
            title: "New Dialogue Map",
          });
          if (active) {
            setSession(created);
            await refreshSessionsList();
          }
        }
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          if (active) setAuthRequired(true);
          return;
        }
        if (active) {
          showError(err instanceof Error ? err.message : String(err));
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [refreshSessionsList, showError, authNonce]);

  // Keep ?session= in step with the open session. Switching sessions adds a history entry,
  // so Back/Forward move between them; the first sync (no or stale id in the URL) replaces.
  useEffect(() => {
    if (!session?.id || url.session === session.id) return;
    setUrl({ session: session.id }, { replace: !url.session });
  }, [session?.id]);

  // Back/Forward (or an edited URL) changed ?session=: load that session.
  useEffect(() => {
    if (!session || !url.session || url.session === session.id) return;
    void api
      .getSession(url.session)
      .then(({ session: loaded }) => setSession(loaded))
      // Unknown id: point the URL back at the session that's open
      .catch(() => setUrl({ session: session.id }, { replace: true }));
  }, [url.session]);

  // Live SSE Subscription for the active session
  useEffect(() => {
    if (!session?.id) return;

    const unsubscribe = api.subscribeToSession(session.id, (evt) => {
      switch (evt.type) {
        case "session.snapshot":
          setSession(evt.session);
          break;

        case "session.updated":
          setSession((prev) =>
            prev
              ? {
                  ...prev,
                  title: evt.title,
                  rootFocus: evt.rootFocus,
                  autoMap: evt.autoMap,
                }
              : prev
          );
          void refreshSessionsList();
          break;

        case "session.audio":
          setSession((prev) =>
            prev
              ? {
                  ...prev,
                  audio: evt.audio,
                  updatedAt: new Date().toISOString(),
                }
              : prev
          );
          break;

        case "session.context_updated":
          setSession((prev) => {
            if (!prev) return prev;
            const hostSet = new Set(evt.hostTurnIds || []);
            return {
              ...prev,
              hostContext: evt.hostContext,
              turns:
                hostSet.size > 0
                  ? prev.turns.map((t) =>
                      hostSet.has(t.id) ? { ...t, kind: "host_context" } : t
                    )
                  : prev.turns,
            };
          });
          break;

        case "speaker.updated":
          setSession((prev) => {
            if (!prev) return prev;
            const exists = prev.speakers.some((s) => s.id === evt.speaker.id);
            const speakers = exists
              ? prev.speakers.map((s) =>
                  s.id === evt.speaker.id ? evt.speaker : s
                )
              : [...prev.speakers, evt.speaker].sort(
                  (a, b) => a.channel - b.channel
                );
            return { ...prev, speakers };
          });
          break;

        case "transcript.partial":
          setPartialText(evt.text);
          break;

        case "transcript.turn":
          setPartialText("");
          setSession((prev) => {
            if (!prev) return prev;
            if (prev.turns.some((t) => t.id === evt.turn.id)) return prev;
            return { ...prev, turns: [...prev.turns, evt.turn] };
          });
          break;

        case "transcript.turn_updated":
          setSession((prev) => {
            if (!prev) return prev;
            return {
              ...prev,
              turns: prev.turns.map((t) =>
                t.id === evt.turn.id ? evt.turn : t
              ),
            };
          });
          break;

        case "transcript.turns_batch":
          setPartialText("");
          setSession((prev) => {
            if (!prev) return prev;
            const existingIds = new Set(prev.turns.map((t) => t.id));
            const fresh = evt.turns.filter((t) => !existingIds.has(t.id));
            return { ...prev, turns: [...prev.turns, ...fresh] };
          });
          break;

        case "map.updated":
          setSession((prev) => {
            if (!prev) return prev;
            const activity = evt.activity
              ? [...prev.activity.slice(-79), evt.activity]
              : prev.activity;
            // Mark turns referenced by nodes as mapped locally too
            const referencedTurns = new Set<string>();
            for (const n of evt.nodes) {
              for (const tid of n.turnIds) referencedTurns.add(tid);
            }
            const turns = prev.turns.map((t) =>
              referencedTurns.has(t.id) ? { ...t, mapped: true } : t
            );
            return {
              ...prev,
              nodes: evt.nodes,
              crossLinks: evt.crossLinks,
              activity,
              turns,
            };
          });
          if (evt.affectedNodeIds.length > 0) {
            const set = new Set(evt.affectedNodeIds);
            setRecentNodeIds(set);
            setTimeout(() => setRecentNodeIds(new Set()), 1500);
          }
          void refreshSessionsList();
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
  }, [session?.id, refreshSessionsList, showError]);

  const stats = useMemo(
    () =>
      session
        ? computeConklinStats(session.nodes, session.turns)
        : computeConklinStats([], []),
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
    const { session: loaded } = await api.getSession(id);
    setSession(loaded);
  };

  const handleCreateSession = async () => {
    micRef.current?.stop();
    micRef.current = null;
    setIsListening(false);
    const { session: created } = await api.createSession({
      title: "New Dialogue Map",
    });
    setSession(created);
    setSelectedNodeId(null);
    await refreshSessionsList();
  };

  const handleDeleteSession = async (id: string) => {
    await api.deleteSession(id);
    const remaining = await refreshSessionsList();
    if (session?.id === id && remaining[0]) {
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
      setSession(created);
      setSelectedNodeId(null);
      setHighlightedNodeIds(new Set());
      setActiveSpeakerFilter(null);
      setLens("all");
      await refreshSessionsList();
    }

    setIsTranscribing(true);
    try {
      await api.transcribeFile(targetSession.id, file, {
        asrModel: targetSession.speechConfig.offlineAsrModel,
        diarizationModel: targetSession.speechConfig.diarizationModel,
        autoMap: targetSession.autoMap,
      });
      await refreshSessionsList();
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
      setSession(created);
      await refreshSessionsList();
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
      await refreshSessionsList();
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
      await refreshSessionsList();
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
        setSession(created);
        await refreshSessionsList();
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
      <div className="w-screen h-screen flex items-center justify-center bg-[#FAF9F6] p-4">
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setAuthError(null);
            try {
              await api.authLogin(authTokenInput.trim());
              setAuthRequired(false);
              setAuthTokenInput("");
              setAuthNonce((n) => n + 1);
            } catch (err) {
              setAuthError(
                err instanceof Error ? err.message : "Invalid access token"
              );
            }
          }}
          className="w-full max-w-sm bg-white border border-stone-200 rounded-2xl shadow-sm p-6 space-y-4"
        >
          <div>
            <h1 className="font-display text-lg font-semibold text-stone-900">
              Sign in to Dialogger
            </h1>
            <p className="text-xs text-stone-500 mt-1">
              Enter the server&apos;s <code className="font-mono-code">DIALOGGER_API_KEY</code> to access sessions, audio, and live mapping.
            </p>
          </div>
          <input
            type="password"
            value={authTokenInput}
            onChange={(e) => setAuthTokenInput(e.target.value)}
            placeholder="Access token"
            autoFocus
            className="w-full px-3 py-2 text-sm border border-stone-200 rounded-lg focus:outline-none focus:border-blue-500"
          />
          {authError && (
            <div className="text-xs text-rose-600 font-medium">{authError}</div>
          )}
          <button
            type="submit"
            className="w-full py-2 rounded-lg bg-stone-900 text-white text-sm font-medium hover:bg-stone-800 transition"
          >
            Unlock
          </button>
        </form>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="w-screen h-screen flex items-center justify-center bg-[#FAF9F6] text-stone-500 text-sm">
        Loading Dialogger…
      </div>
    );
  }

  return (
    <div className="w-screen h-screen flex flex-col overflow-hidden bg-[#FAF9F6]">
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
        onRenameSession={(title) =>
          void api.updateSession(session.id, { title })
        }
        onToggleMic={() => void handleToggleMic()}
        onUploadAudio={(f) => void handleUploadAudio(f)}
        onOpenYouTubeModal={() => openPanel("youtube")}
        onStopTranscribing={() => void api.stopTranscription(session.id)}
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
              setSession(updated);
              setSelectedNodeId(null);
              setHighlightedNodeIds(new Set());
              await refreshSessionsList();
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

        <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">
          <HostContextBar
            items={session.hostContext || []}
            speakers={session.speakers}
            onAddContext={(category: HostContextCategory, summary: string) =>
              void api.applyMapOps(session.id, {
                actor: "human",
                summary: `Added session ${category.replace(/_/g, " ")} context`,
                ops: [{ op: "add_host_context", category, summary }],
              })
            }
            onRemoveContext={(id: string) =>
              void api.applyMapOps(session.id, {
                actor: "human",
                ops: [{ op: "remove_host_context", id }],
              })
            }
            onFocusTurn={(turnId) => {
              const turn = session.turns.find((t) => t.id === turnId);
              if (turn) handleSelectTurn(turn);
            }}
          />

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
        </div>

        <NodeInspector
          session={session}
          selectedNode={selectedNode}
          onClose={() => setSelectedNodeId(null)}
          onUpdateNode={(id, patch) =>
            void api.applyMapOps(session.id, {
              actor: "human",
              ops: [{ op: "update_node", id, ...patch }],
            })
          }
          onDeleteNode={(id) => {
            setSelectedNodeId(null);
            void api.applyMapOps(session.id, {
              actor: "human",
              summary: "Removed node branch",
              ops: [{ op: "delete_node", id, cascade: true }],
            });
          }}
          onAddChild={(parentId, type, label) =>
            void api.applyMapOps(session.id, {
              actor: "human",
              summary: `Added ${IBIS_NODE_META[type].shortName} node`,
              ops: [{ op: "add_node", parentId, type, label }],
            })
          }
          onFocusTurn={(turnId) => {
            const turn = session.turns.find((t) => t.id === turnId);
            if (turn) handleSelectTurn(turn);
          }}
          onSelectNode={(id) => setSelectedNodeId(id)}
        />
      </div>

      {/* Error Toast */}
      {toastError && (
        <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-50 max-w-lg px-4 py-2.5 rounded-xl bg-rose-950 text-rose-50 text-xs font-medium shadow-lg border border-rose-800 flex items-center gap-3">
          <span>{toastError}</span>
          <button
            type="button"
            onClick={() => setToastError(null)}
            className="text-rose-300 hover:text-white font-bold"
          >
            ✕
          </button>
        </div>
      )}

      {/* Panels load on demand (see components/panels.tsx) */}
      <Suspense fallback={null}>
        {url.panel === "agent" && (
          <AgentModal session={session} onClose={closePanel} />
        )}

        {url.panel === "settings" && (
          <SettingsModal
            session={session}
            onClose={closePanel}
            onUpdateSpeechConfig={async (patch) => {
              const { session: updated } = await api.updateSession(session.id, {
                speechConfig: patch,
              });
              setSession(updated);
            }}
          />
        )}

        {url.panel === "youtube" && (
          <YouTubeModal
            session={session}
            onClose={closePanel}
            onStartImport={(params) => handleImportYouTube(params)}
          />
        )}
      </Suspense>
    </div>
  );
}
