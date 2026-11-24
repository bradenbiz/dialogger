import { useMemo, useSyncExternalStore } from "react";

export const PANELS = ["settings", "youtube", "agent"] as const;
export type Panel = (typeof PANELS)[number];

/** What the URL holds: ?session=<id>&panel=settings|youtube|agent. */
export interface UrlState {
  session?: string;
  panel?: Panel;
}

const CHANGE = "dialogger:urlchange";

function subscribe(onChange: () => void) {
  window.addEventListener("popstate", onChange);
  window.addEventListener(CHANGE, onChange);
  return () => {
    window.removeEventListener("popstate", onChange);
    window.removeEventListener(CHANGE, onChange);
  };
}

/** Invalid values are dropped, so stale or hand-edited links still load. */
export function parseUrlState(search: string): UrlState {
  const params = new URLSearchParams(search);
  const session = params.get("session") || undefined;
  const panel = params.get("panel");
  return {
    session,
    panel: PANELS.includes(panel as Panel) ? (panel as Panel) : undefined,
  };
}

/** Marks a history entry the app pushed to open a panel, so closing it can step back. */
const PANEL_ENTRY = "dialoggerPanel";

/**
 * Update the URL. Pushes a history entry (so Back/Forward move between sessions and
 * panels) unless `replace` is set.
 */
export function setUrlState(
  patch: Partial<UrlState>,
  { replace = false, panelEntry = false } = {}
) {
  const url = new URL(window.location.href);
  for (const [key, value] of Object.entries(patch)) {
    if (value) url.searchParams.set(key, value);
    else url.searchParams.delete(key);
  }
  if (url.href === window.location.href) return;
  const state = panelEntry ? { [PANEL_ENTRY]: true } : {};
  window.history[replace ? "replaceState" : "pushState"](state, "", url);
  window.dispatchEvent(new Event(CHANGE));
}

export function openPanel(panel: Panel) {
  setUrlState({ panel }, { panelEntry: true });
}

/**
 * Close the open panel. If the app opened it, step back past that entry, so Back
 * afterwards doesn't reopen it; for a panel opened from a link, drop it from the URL.
 */
export function closePanel() {
  if (window.history.state?.[PANEL_ENTRY]) window.history.back();
  else setUrlState({ panel: undefined }, { replace: true });
}

/** The URL's state, re-rendering on Back/Forward and on setUrlState. */
export function useUrlState() {
  const search = useSyncExternalStore(subscribe, () => window.location.search);
  const state = useMemo(() => parseUrlState(search), [search]);
  return [state, setUrlState] as const;
}
