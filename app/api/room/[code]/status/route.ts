import { NextRequest, NextResponse } from "next/server";
import { getRoomStatus, RoomError } from "@/lib/room";
import { enforceRateLimit } from "@/lib/rate-limit";
import { errorResponse } from "@/lib/api-error";

// Room codes are only 4 chars (~1M combos) — without a limit here, an
// unthrottled client could enumerate the whole code space and read every
// active room's player names. The host's own page polls this every 4s
// (ROOM_POLL_INTERVAL_MS in app/page.tsx), i.e. up to 150 requests per
// 10-minute window on its own — keep the limit comfortably above that.
const STATUS_LIMIT = 200;
const STATUS_WINDOW_SECONDS = 10 * 60;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  const { code } = await params;

  const limited = await enforceRateLimit(
    req,
    "room:status",
    STATUS_LIMIT,
    STATUS_WINDOW_SECONDS,
    "rate_limited"
  );
  if (limited) return limited;

  try {
    const status = await getRoomStatus(code);
    return NextResponse.json(status);
  } catch (err: unknown) {
    if (err instanceof RoomError) {
      return errorResponse(err.code, err.status, { params: err.params });
    }
    return errorResponse("room_status_failed", 500);
  }
}
