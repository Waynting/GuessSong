import { NextRequest, NextResponse } from "next/server";
import { createRoom, RoomError } from "@/lib/room";
import { enforceRateLimit } from "@/lib/rate-limit";

const CREATE_ROOM_LIMIT = 10;
const CREATE_ROOM_WINDOW_SECONDS = 10 * 60;

export async function POST(req: NextRequest) {
  const limited = await enforceRateLimit(
    req,
    "room:create",
    CREATE_ROOM_LIMIT,
    CREATE_ROOM_WINDOW_SECONDS,
    "Too many rooms created, please slow down"
  );
  if (limited) return limited;

  try {
    const { roomCode, expiresAt, hostToken } = await createRoom();
    return NextResponse.json({ roomCode, expiresAt, hostToken });
  } catch (err: unknown) {
    const status = err instanceof RoomError ? err.status : 500;
    const message = err instanceof Error ? err.message : "Failed to create room";
    return NextResponse.json({ error: message }, { status });
  }
}
