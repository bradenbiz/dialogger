import { defineHandler, defineRouteMeta } from "nitro";
import { SESSION_COOKIE } from "../../auth";

defineRouteMeta({
  openAPI: {
    tags: ["Auth"], summary: "Clear the session cookie",
  },
});

export default defineHandler((event) => {
  event.res.headers.append(
    "set-cookie",
    `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`
  );
  return { ok: true };
});
