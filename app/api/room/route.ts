import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createRoom, RoomError } from "@/lib/room";
import { enforceRateLimit } from "@/lib/rate-limit";
import { ROOM_CODE_LENGTH } from "@/types/room";

const CREATE_ROOM_LIMIT = 10;
const CREATE_ROOM_WINDOW_SECONDS = 10 * 60;

/**
 * `code` lets the caller open the mailbox under a code it already holds — the
 * buzzer Worker mints one first so a party scans a single QR (see
 * lib/room-client.ts). Optional: the Mixed-only flow sends no body at all, and
 * a room that generates its own code is still the default.
 */
const CreateRoomSchema = z.object({
  code: z.string().trim().length(ROOM_CODE_LENGTH).optional(),
});

export async function POST(req: NextRequest) {
  const limited = await enforceRateLimit(
    req,
    "room:create",
    CREATE_ROOM_LIMIT,
    CREATE_ROOM_WINDOW_SECONDS,
    "Too many rooms created, please slow down"
  );
  if (limited) return limited;

  // An empty body is the historical shape of this call and still valid, so a
  // failed parse means "no requested code", not a bad request.
  let requestedCode: string | undefined;
  try {
    const parsed = CreateRoomSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid room code" }, { status: 422 });
    }
    requestedCode = parsed.data.code;
  } catch {
    requestedCode = undefined;
  }

  try {
    const { roomCode, expiresAt, hostToken } = await createRoom(requestedCode);
    return NextResponse.json({ roomCode, expiresAt, hostToken });
  } catch (err: unknown) {
    const status = err instanceof RoomError ? err.status : 500;
    const message = err instanceof Error ? err.message : "Failed to create room";
    return NextResponse.json({ error: message }, { status });
  }
}
