import type { Panel } from "@/lib/url-state";
import { lazyWithPreload } from "@/lib/lazy";

// Every dialog, panel, and page that isn't on screen at first paint is its own chunk (the
// component plus its icons), fetched when it's first shown, or earlier when the user hovers or
// focuses a control that opens it. Once fetched, it renders without a Suspense fallback.

// URL panels (?panel=…): buttons that open one spread `preloadOnIntent(panel)`
const panels = {
  agent: lazyWithPreload(() => import("./AgentModal").then((m) => m.AgentModal)),
  settings: lazyWithPreload(() => import("./SettingsModal").then((m) => m.SettingsModal)),
  youtube: lazyWithPreload(() => import("./YouTubeModal").then((m) => m.YouTubeModal)),
} satisfies Record<Panel, { preloadOnIntent: object }>;

export const AgentModal = panels.agent.Component;
export const SettingsModal = panels.settings.Component;
export const YouTubeModal = panels.youtube.Component;

/** Props for a button that opens `panel`: preload on hover or keyboard focus. */
export function preloadOnIntent(panel: Panel) {
  return panels[panel].preloadOnIntent;
}

// The node editor replaces the activity feed once a node is selected. Controls that select a
// node spread `preloadNodeEditor`.
export const { Component: NodeEditor, preloadOnIntent: preloadNodeEditor } = lazyWithPreload(
  () => import("./NodeEditor").then((m) => m.NodeEditor)
);

// The sign-in screen only shows after a 401, so nothing preloads it
export const { Component: SignInScreen } = lazyWithPreload(() =>
  import("./SignInScreen").then((m) => m.SignInScreen)
);
