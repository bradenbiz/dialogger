import { createElement, lazy, useState, type ComponentType } from "react";

/**
 * A component whose code loads on demand. Spread `preloadOnIntent` on the controls that open it,
 * so the download starts on hover or keyboard focus, before the click. Render `Component` inside
 * a <Suspense>.
 *
 * Once the code has loaded, `Component` renders it directly. A plain lazy() component suspends
 * on its first render even when its code is ready, and React keeps a shown fallback up for
 * ~300 ms, so a prefetched menu or panel would still flash its fallback the first time it opens.
 */
export function lazyWithPreload<P extends object>(load: () => Promise<ComponentType<P>>) {
  let loaded: ComponentType<P> | undefined;
  let pending: Promise<ComponentType<P>> | undefined;

  const preload = () =>
    (pending ??= load().then(
      (component) => (loaded = component),
      (err: unknown) => {
        pending = undefined; // let a later preload or render retry
        throw err;
      }
    ));

  const Lazy = lazy(() => preload().then((component) => ({ default: component })));

  function Component(props: P) {
    // Pick once per mount: switching from Lazy to the loaded component later would remount it
    const [Impl] = useState<ComponentType<P>>(() => loaded ?? Lazy);
    return createElement(Impl, props);
  }

  const preloadOnIntent = {
    onMouseEnter: () => void preload(),
    onFocus: () => void preload(),
  };

  return { Component, preload, preloadOnIntent };
}
