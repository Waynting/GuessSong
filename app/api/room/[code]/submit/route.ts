import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { submitToRoom, RoomError } from "@/lib/room";
import { enforceRateLimit } from "@/lib/rate-limit";

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
    "Too many attempts, please slow down"
  );
  if (limited) return limited;

  try {
    const body = SubmitSchema.parse(await req.json());
    const { trackCount } = await submitToRoom(code, body.playerName, body.playlistUrl);
    return NextResponse.json({ ok: true, trackCount });
  } catch (err: unknown) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: "Missing name or playlist URL" }, { status: 400 });
    }
    const status = err instanceof RoomError ? err.status : 500;
    const message = err instanceof Error ? err.message : "Failed to submit playlist";
    return NextResponse.json({ error: message }, { status });
  }
}
