import { NextRequest, NextResponse } from "next/server";
import { consumeRoomPool, RoomError } from "@/lib/room";
import { enforceRateLimit } from "@/lib/rate-limit";
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
    "Too many attempts, please slow down"
  );
  if (limited) return limited;

  const rawSampledPerPlayer = req.nextUrl.searchParams.get("sampledPerPlayer");
  const sampledPerPlayer = rawSampledPerPlayer
    ? Number.parseInt(rawSampledPerPlayer, 10)
    : DEFAULT_SAMPLED_PER_PLAYER;

  if (!Number.isFinite(sampledPerPlayer) || sampledPerPlayer < 1) {
    return NextResponse.json({ error: "Invalid sampledPerPlayer" }, { status: 400 });
  }

  const hostToken = req.headers.get("x-host-token") ?? "";

  try {
    const pool = await consumeRoomPool(code, sampledPerPlayer, hostToken);
    return NextResponse.json(pool);
  } catch (err: unknown) {
    const status = err instanceof RoomError ? err.status : 500;
    const message = err instanceof Error ? err.message : "Failed to load pool";
    return NextResponse.json({ error: message }, { status });
  }
}
