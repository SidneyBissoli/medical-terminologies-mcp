import type { AxiosError } from 'axios';

const MAX_STRING_BODY_PREVIEW = 500;

/**
 * Extracts a human-readable message from an AxiosError, handling shapes
 * that show up in production but that the previous one-liner
 * (`error.response?.data?.message || error.message`) collapsed to
 * "undefined" or to the generic axios message:
 *
 *   - JSON `{ message }`             — most REST APIs (NLM, RxNorm)
 *   - JSON `{ error: { message } }`  — some terminology services
 *   - JSON `{ error_description }`   — OAuth standard error response
 *     (this is the WHO token endpoint's shape on 401/400)
 *   - JSON `{ error: 'string' }`     — a few APIs do this
 *   - Plain string body              — Cloudflare challenges, nginx 502
 *     pages, maintenance HTML. Truncated at 500 chars so an HTML body
 *     doesn't dominate the log line.
 *   - Fallback                       — error.message ("Network Error",
 *     "timeout of 30000ms exceeded", etc.)
 */
export function extractErrorMessage(error: AxiosError): string {
  const data = error.response?.data;

  if (data && typeof data === 'object') {
    const obj = data as Record<string, unknown>;

    if (typeof obj.message === 'string' && obj.message.length > 0) {
      return obj.message;
    }
    if (typeof obj.error_description === 'string' && obj.error_description.length > 0) {
      return obj.error_description;
    }
    if (obj.error && typeof obj.error === 'object') {
      const inner = obj.error as Record<string, unknown>;
      if (typeof inner.message === 'string' && inner.message.length > 0) {
        return inner.message;
      }
    }
    if (typeof obj.error === 'string' && obj.error.length > 0) {
      return obj.error;
    }
  }

  if (typeof data === 'string' && data.length > 0) {
    return data.length <= MAX_STRING_BODY_PREVIEW
      ? data
      : `${data.slice(0, MAX_STRING_BODY_PREVIEW)}…`;
  }

  return error.message;
}
