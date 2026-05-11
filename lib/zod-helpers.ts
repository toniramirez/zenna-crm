/**
 * Convert a Zod safeParse error into a flat `{ fieldName: message }` map
 * for surfacing in form UIs. Only the first error per field is kept.
 *
 * Typed loosely against `z.SafeParseError` shape so it accepts any schema's
 * failure result (Zod 4 widened `path` to `PropertyKey[]` which makes the
 * generic-on-T overload painful).
 */
type ZodIssueLite = {
  path: ReadonlyArray<PropertyKey>;
  message: string;
};

type ZodFailureLite = {
  success: false;
  error: { issues: ReadonlyArray<ZodIssueLite> };
};

export function fieldErrorsFromZod(
  parsed: ZodFailureLite,
): Record<string, string> {
  const fieldErrors: Record<string, string> = {};
  for (const issue of parsed.error.issues) {
    const head = issue.path[0];
    const key =
      typeof head === "string" || typeof head === "number"
        ? String(head)
        : "";
    if (key && !fieldErrors[key]) fieldErrors[key] = issue.message;
  }
  return fieldErrors;
}
