// SWR imports `use-sync-external-store/shim`, a React 17 polyfill. React 19 has the hook
// built in, so vite.config.ts aliases the shim to this module to keep it out of the bundle.
export { useSyncExternalStore } from "react";
