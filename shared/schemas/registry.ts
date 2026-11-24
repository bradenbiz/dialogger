import { z } from "zod";

/**
 * Named schemas that become `#/components/schemas/<id>` in the OpenAPI spec.
 * Routes reference them by `$ref`; the server fills in their JSON Schema at runtime.
 */
export const apiSchemas = z.registry<{ id: string; description?: string }>();

export function named<T extends z.ZodType>(
  id: string,
  schema: T,
  description?: string
): T {
  (schema as z.ZodType).register(apiSchemas, { id, description });
  return schema;
}

/** JSON Schema for every named schema, keyed by id, with refs pointing at OpenAPI components. */
export function toOpenApiComponents(): Record<string, unknown> {
  const { schemas } = z.toJSONSchema(apiSchemas, {
    target: "draft-2020-12",
    io: "input",
    unrepresentable: "any",
    uri: (id) => `#/components/schemas/${id}`,
  });
  for (const schema of Object.values(schemas)) {
    delete (schema as Record<string, unknown>).$schema;
    delete (schema as Record<string, unknown>).$id;
  }
  return schemas;
}
