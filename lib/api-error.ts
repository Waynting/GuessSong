/**
 * The one way an API route answers with an error.
 *
 * Routes send a machine-readable `code` and let the client pick the language —
 * see the header of lib/error-messages.ts for why that decision cannot live on
 * this side. The English text rides along in `error` so logs and any client
 * older than the code it was sent still read sensibly.
 */

import { NextResponse } from "next/server";
import { errorMessage, type ApiErrorBody, type AppErrorCode } from "@/lib/error-messages";

export interface ErrorResponseOptions {
  /** Fills the message's placeholders, e.g. `{ seconds }` on a cooldown. */
  params?: Record<string, string | number>;
  /**
   * Seconds until the caller should retry. Sent in the body *and* as
   * `Retry-After`, so the browser-facing header and the sentence the player
   * reads can never disagree.
   */
  retryAfter?: number;
}

export function errorResponse(
  code: AppErrorCode,
  status: number,
  options: ErrorResponseOptions = {}
): NextResponse<ApiErrorBody> {
  const retryAfter =
    typeof options.retryAfter === "number" && Number.isFinite(options.retryAfter)
      ? Math.ceil(options.retryAfter)
      : undefined;

  const params =
    retryAfter !== undefined ? { seconds: retryAfter, ...options.params } : options.params;

  return NextResponse.json<ApiErrorBody>(
    {
      error: errorMessage(code, "en", { params }),
      code,
      ...(retryAfter !== undefined ? { retryAfter } : {}),
    },
    {
      status,
      ...(retryAfter !== undefined
        ? { headers: { "Retry-After": String(retryAfter) } }
        : {}),
    }
  );
}
