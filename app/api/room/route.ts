import { NextRequest, NextResponse } from "next/server";
import { createRoom, RoomError } from "@/lib/room";
import { rateLimit, getClientIp } from "@/lib/rate-limit";

const CREATE_ROOM_LIMIT = 10;
const CREATE_ROOM_WINDOW_SECONDS = 10 * 60;

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  const { allowed } = await rateLimit(`room:create:${ip}`, CREATE_ROOM_LIMIT, CREATE_ROOM_WINDOW_SECONDS);
  if (!allowed) {
    return NextResponse.json({ error: "Too many rooms created, please slow down" }, { status: 429 });
  }

  try {
    const { roomCode, expiresAt, hostToken } = await createRoom();
    return NextResponse.json({ roomCode, expiresAt, hostToken });
  } catch (err: unknown) {
    const status = err instanceof RoomError ? err.status : 500;
    const message = err instanceof Error ? err.message : "Failed to create room";
    return NextResponse.json({ error: message }, { status });
  }
}
