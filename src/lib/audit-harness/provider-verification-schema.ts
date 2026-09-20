/** Keep the complete response shape but enforce numeric/length bounds locally.
 * Large nested maxItems/minLength constraints can make provider grammar compilation
 * expensive. This does NOT change the Zod parser or coverage/claim validation. */
export function providerVerificationSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const localBounds = new Set(["minimum", "maximum", "minLength", "maxLength", "minItems", "maxItems"]);
  const visit = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(visit);
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(Object.entries(value).filter(([key]) => !localBounds.has(key))
      .map(([key, child]) => {
        // Property names may coincide with JSON Schema keywords. Never remove them.
        if (key === "properties" && child && typeof child === "object" && !Array.isArray(child)) {
          return [key, Object.fromEntries(Object.entries(child).map(([name, definition]) => [name, visit(definition)]))];
        }
        return [key, visit(child)];
      }));
  };
  return visit(schema) as Record<string, unknown>;
}
