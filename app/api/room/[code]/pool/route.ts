import { NextRequest, NextResponse } from "next/server";
import { consumeRoomPool, RoomError } from "@/lib/room";
import { enforceRateLimit } from "@/lib/rate-limit";
import { errorResponse } from "@/lib/api-error";
import { DEFAULT_SAMPLED_PER_PLAYER } from "@/types/room";

// hostToken already gates the actual pool consumption, but this route is
// still an unthrottled oracle for room-code existence/state without a
// limit (see lib/rate-limit.ts's doc comment on the 4-char code space).
const POOL_LIMIT = 20;
const POOL_WINDOW_SECONDS = 10 * 60;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  const { code } = await params;

  const limited = await enforceRateLimit(
    req,
    "room:pool",
    POOL_LIMIT,
    POOL_WINDOW_SECONDS,
    "rate_limited"
  );
  if (limited) return limited;

  const rawSampledPerPlayer = req.nextUrl.searchParams.get("sampledPerPlayer");
  const sampledPerPlayer = rawSampledPerPlayer
    ? Number.parseInt(rawSampledPerPlayer, 10)
    : DEFAULT_SAMPLED_PER_PLAYER;

  if (!Number.isFinite(sampledPerPlayer) || sampledPerPlayer < 1) {
    return errorResponse("room_invalid_sample_size", 400);
  }

  const hostToken = req.headers.get("x-host-token") ?? "";

  try {
    const pool = await consumeRoomPool(code, sampledPerPlayer, hostToken);
    return NextResponse.json(pool);
  } catch (err: unknown) {
    if (err instanceof RoomError) {
      return errorResponse(err.code, err.status, { params: err.params });
    }
    return errorResponse("room_start_failed", 500);
  }
}
