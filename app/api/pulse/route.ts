import { NextRequest, NextResponse } from "next/server";
import { getClientIp, rateLimit } from "@/lib/rate-limit";
import { parsePulse } from "@/lib/pulse";
import {
  recordFirstClip,
  recordGameEnd,
  recordGameLeft,
  recordGameOverTap,
  recordMixedNudge,
  recordRefusalRecovery,
  recordGameStart,
  recordLoopImpression,
  recordQuizShare,
} from "@/lib/loop-stats";
import { recordQuizCopy, recordQuizSocial } from "@/lib/loop-stats";

/**
 * Fire-and-forget counters from the browser. See `lib/pulse.ts` for what the
 * two events are and why they cannot ride on an existing request.
 *
 * Sent with `navigator.sendBeacon`, so this handler must stay cheap and must
 * never make the caller care about the answer.
 */

/**
 * Sized for a household, not a person: the limiter is keyed by IP and a party
 * is a dozen phones behind one Wi-Fi address, each reporting an impression and
 * possibly a game start. `app/api/room/[code]/status` is the standing lesson
 * that a per-device budget throttles a whole room.
 */
const PULSE_LIMIT = 240;
const PULSE_WINDOW_SECONDS = 60 * 60;

/** Beacons are tiny; anything larger is not one of ours. */
const MAX_BODY_BYTES = 512;

export async function POST(req: NextRequest) {
  // Over budget: drop the event and say nothing. A 429 would be worse than
  // useless — `sendBeacon` cannot see it, and any client that could would
  // retry, spending more of the budget that was just found to be spent.
  try {
    const ip = getClientIp(req);
    const { allowed } = await rateLimit(
      `pulse:${ip}`,
      PULSE_LIMIT,
      PULSE_WINDOW_SECONDS
    );
    if (!allowed) return new NextResponse(null, { status: 204 });
  } catch {
    // Fail open: an unavailable limiter must not cost a measurement.
  }

  let body: unknown;
  try {
    const text = await req.text();
    if (text.length > MAX_BODY_BYTES) {
      return new NextResponse(null, { status: 400 });
    }
    body = JSON.parse(text);
  } catch {
    return new NextResponse(null, { status: 400 });
  }

  const event = parsePulse(body);
  if (!event) return new NextResponse(null, { status: 400 });

  // Every recorder is fail-soft, so nothing below can throw.
  switch (event.kind) {
    case "loop_impression":
      await recordLoopImpression(event.surface);
      break;
    case "game_started":
      await recordGameStart(event.hostGameIndex, event.mixed, event.source);
      break;
    case "game_finished":
      await recordGameEnd(event.end, event.roundsPlayed, {
        host: event.host,
        screen: event.screen,
        source: event.source,
      });
      break;
    case "first_clip":
      await recordFirstClip(event.path, event.outcome);
      break;
    case "game_left":
      await recordGameLeft(event.roundsPlayed, event.host, event.source);
      break;
    case "game_over_tap":
      await recordGameOverTap(event.target);
      break;
    case "mixed_nudge":
      await recordMixedNudge(event.stage);
      break;
    case "refusal_recovery":
      await recordRefusalRecovery(event.stage, event.topic, event.stage === "recovered" ? event.via : undefined);
      break;
    case "quiz_shared":
      await recordQuizShare(event.by, event.outcome);
      break;
    // A kind `parsePulse` accepts and this switch has no case for answers
    // 204 and records nothing — the counter just never moves.
    // `tests/pulse.test.ts` reads this file for a case per kind.
    case "quiz_copied":
      await recordQuizCopy(event.by, event.outcome);
      break;
    case "quiz_social":
      await recordQuizSocial(event.by, event.platform);
      break;
  }

  return new NextResponse(null, { status: 204 });
}
