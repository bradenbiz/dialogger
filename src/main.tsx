import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
// Renders nothing in production builds (the package swaps in a no-op)
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { App } from "./App";
import { queryClient } from "./lib/queries";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
      {/* Below 2xl the map reaches the right edge, so sit just above its zoom controls;
          from 2xl the live mapping feed covers that corner, so use the default spot there */}
      <div className="fixed bottom-16 right-3 2xl:bottom-2 2xl:right-2 z-50">
        <ReactQueryDevtools buttonPosition="relative" />
      </div>
    </QueryClientProvider>
  </StrictMode>
);
