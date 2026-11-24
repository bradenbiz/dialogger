import { defineMiddleware } from "nitro/h3";
import { toOpenApiComponents } from "../../shared/schemas/registry";
// Importing these modules registers every named schema in the registry.
import "../../shared/schemas/contracts";
import "../../shared/schemas/events";
import "../../shared/schemas/models";

/** Nitro's own routes that aren't part of the Dialogger API. */
const HIDDEN_PATHS = ["/_openapi.json", "/_swagger", "/_scalar", "/_nitro/tasks/{*param1}", "/{*param1}"];

let cachedSchemas: Record<string, unknown> | null = null;

/**
 * Nitro generates paths from each route's defineRouteMeta, which can only hold static
 * literals. Those reference `#/components/schemas/<Name>`; this fills in the definitions
 * from the shared Zod schemas so the docs and the validation can't drift apart.
 */
export default defineMiddleware(async (event, next) => {
  if (event.url.pathname !== "/_openapi.json") return;

  const result = await next();
  const spec = (result instanceof Response ? await result.json() : result) as {
    paths?: Record<string, unknown>;
    components?: { schemas?: Record<string, unknown> };
  };

  cachedSchemas ??= toOpenApiComponents();
  spec.components = {
    ...spec.components,
    schemas: { ...spec.components?.schemas, ...cachedSchemas },
  };
  for (const hidden of HIDDEN_PATHS) delete spec.paths?.[hidden];
  return spec;
});
