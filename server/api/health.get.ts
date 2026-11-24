import { defineHandler, defineRouteMeta } from "nitro";
import { getQuery } from "nitro/h3";
import type { HealthResponse } from "../../shared/api";
import { API_KEY, OWNER_KEY, isAuthorizedRequest } from "../auth";
import { sessionStore } from "../store";

defineRouteMeta({
  openAPI: {
    "tags": [
      "Health"
    ],
    "summary": "Health check and auth status",
    "responses": {
      "200": {
        "description": "OK",
        "content": {
          "application/json": {
            "schema": {
              "$ref": "#/components/schemas/HealthResponse"
            }
          }
        }
      }
    }
  },
});

export default defineHandler((event) => {
  const { api_key } = getQuery(event);
  const authenticated = isAuthorizedRequest(
    event.req.headers,
    typeof api_key === "string" ? api_key : undefined
  );
  return {
    ok: true,
    service: "dialogger",
    authRequired: Boolean(API_KEY || OWNER_KEY),
    authenticated,
    sessions: authenticated ? sessionStore.listSessions().length : undefined,
  } satisfies HealthResponse;
});
