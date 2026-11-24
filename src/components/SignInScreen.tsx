import { useState } from "react";
// Besides marking the screen, the icon keeps React in the main chunk: without one, Rolldown
// moves React into a shared 3 KB chunk that the first load fetches too (see AGENTS.md)
import KeyRound from "lucide-react/icons/key-round";
import { api } from "@/lib/api";
import { revalidateAll } from "@/lib/queries";

/** Asks for the server's API key. Only shown after a 401, so it loads on demand (see panels.tsx). */
export function SignInScreen() {
  const [authTokenInput, setAuthTokenInput] = useState("");
  const [authError, setAuthError] = useState<string | null>(null);

  return (
    <div className="w-screen h-screen flex items-center justify-center bg-[#FAF9F6] p-4">
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setAuthError(null);
          try {
            await api.authLogin(authTokenInput.trim());
            setAuthTokenInput("");
            // Refetch everything that failed with 401 now that the cookie is set
            await revalidateAll();
          } catch (err) {
            setAuthError(
              err instanceof Error ? err.message : "Invalid access token"
            );
          }
        }}
        className="w-full max-w-sm bg-white border border-stone-200 rounded-2xl shadow-sm p-6 space-y-4"
      >
        <div>
          <h1 className="flex items-center gap-2 font-display text-lg font-semibold text-stone-900">
            <KeyRound className="w-4.5 h-4.5 text-stone-500" aria-hidden="true" />
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
