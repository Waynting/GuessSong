import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createRoom, RoomError } from "@/lib/room";
import { enforceRateLimit } from "@/lib/rate-limit";
import { errorResponse } from "@/lib/api-error";
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
    "rate_limited_room_create"
  );
  if (limited) return limited;

  // An empty body is the historical shape of this call and still valid, so a
  // failed parse means "no requested code", not a bad request.
  let requestedCode: string | undefined;
  try {
    const parsed = CreateRoomSchema.safeParse(await req.json());
    if (!parsed.success) {
      return errorResponse("room_code_invalid", 422);
    }
    requestedCode = parsed.data.code;
  } catch {
    requestedCode = undefined;
  }

  try {
    const { roomCode, expiresAt, hostToken } = await createRoom(requestedCode);
    return NextResponse.json({ roomCode, expiresAt, hostToken });
  } catch (err: unknown) {
    if (err instanceof RoomError) {
      return errorResponse(err.code, err.status, {
        params: err.params,
        retryAfter: err.retryAfterSeconds,
      });
    }
    return errorResponse("room_open_failed", 500);
  }
}
