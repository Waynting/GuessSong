import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { submitToRoom, RoomError } from "@/lib/room";
import { enforceRateLimit } from "@/lib/rate-limit";
import { errorResponse } from "@/lib/api-error";

const SubmitSchema = z.object({
  playerName: z.string().trim().min(1).max(24),
  playlistUrl: z.string().trim().min(1),
});

const SUBMIT_LIMIT = 20;
const SUBMIT_WINDOW_SECONDS = 10 * 60;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  const { code } = await params;

  // Keyed by IP only (not IP+code) so a scanner sweeping many codes from one
  // IP still gets throttled, not just repeated guesses against one room.
  const limited = await enforceRateLimit(
    req,
    "room:submit",
    SUBMIT_LIMIT,
    SUBMIT_WINDOW_SECONDS,
    "rate_limited"
  );
  if (limited) return limited;

  try {
    const body = SubmitSchema.parse(await req.json());
    const { trackCount } = await submitToRoom(code, body.playerName, body.playlistUrl);
    return NextResponse.json({ ok: true, trackCount });
  } catch (err: unknown) {
    if (err instanceof z.ZodError) {
      return errorResponse("room_missing_fields", 400);
    }
    if (err instanceof RoomError) {
      return errorResponse(err.code, err.status, {
        params: err.params,
        retryAfter: err.retryAfterSeconds,
      });
    }
    return errorResponse("room_submit_failed", 500);
  }
}
