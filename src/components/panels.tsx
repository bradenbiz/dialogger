import { lazy } from "react";
import type { Panel } from "@/lib/url-state";

// Each panel's code (modal + its icons) is its own chunk, fetched when the panel is first
// opened, or earlier when the user hovers or focuses a button that opens it.
const loaders = {
  agent: () => import("./AgentModal"),
  settings: () => import("./SettingsModal"),
  youtube: () => import("./YouTubeModal"),
} satisfies Record<Panel, () => Promise<unknown>>;

export const AgentModal = lazy(() =>
  loaders.agent().then((m) => ({ default: m.AgentModal }))
);
export const SettingsModal = lazy(() =>
  loaders.settings().then((m) => ({ default: m.SettingsModal }))
);
export const YouTubeModal = lazy(() =>
  loaders.youtube().then((m) => ({ default: m.YouTubeModal }))
);

/** Start fetching a panel's chunk (the browser caches the module, so repeats are free). */
export function preloadPanel(panel: Panel) {
  void loaders[panel]();
}

/** Props for a button that opens `panel`: preload on hover or keyboard focus. */
export function preloadOnIntent(panel: Panel) {
  return {
    onMouseEnter: () => preloadPanel(panel),
    onFocus: () => preloadPanel(panel),
  };
}
