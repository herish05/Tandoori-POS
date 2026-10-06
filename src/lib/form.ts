import type { z } from 'zod'

/** First message per field, keyed by dotted path (`owner.password`). */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const result: Record<string, string> = {}
  for (const issue of error.issues) {
    const key = issue.path.map(String).join('.')
    result[key] ??= issue.message
  }
  return result
}
