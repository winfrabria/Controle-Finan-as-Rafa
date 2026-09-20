/** Native PDF/image inputs do not provide parser-measured OCR coordinates.
 * Do not buy invented rectangles. Page and literal excerpt remain mandatory
 * where required by the source contract; historical measured boxes still parse. */
export function nativeExtractionSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const withoutCoordinates = new Set(["boundingBox", "sourceBoundingBox"]);
  const visit = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(visit);
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(Object.entries(value).map(([key, child]) => {
      if (key === "properties" && child && typeof child === "object" && !Array.isArray(child)) {
        return [key, Object.fromEntries(Object.entries(child).filter(([name]) => !withoutCoordinates.has(name))
          .map(([name, definition]) => [name, visit(definition)]))];
      }
      if (key === "required" && Array.isArray(child)) return [key, child.filter((name) => !withoutCoordinates.has(name))];
      return [key, visit(child)];
    }));
  };
  return visit(schema) as Record<string, unknown>;
}
