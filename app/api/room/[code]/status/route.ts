import { NextRequest, NextResponse } from "next/server";
import { getRoomStatus, RoomError } from "@/lib/room";
import { rateLimit, getClientIp } from "@/lib/rate-limit";

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

  const ip = getClientIp(req);
  const { allowed } = await rateLimit(`room:status:${ip}`, STATUS_LIMIT, STATUS_WINDOW_SECONDS);
  if (!allowed) {
    return NextResponse.json({ error: "Too many attempts, please slow down" }, { status: 429 });
  }

  try {
    const status = await getRoomStatus(code);
    return NextResponse.json(status);
  } catch (err: unknown) {
    const status = err instanceof RoomError ? err.status : 500;
    const message = err instanceof Error ? err.message : "Failed to load room status";
    return NextResponse.json({ error: message }, { status });
  }
}
