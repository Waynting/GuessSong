"use client";

/**
 * Player side of Buzzer Mode. Separate from /j/[code] on purpose: that page is
 * Mixed Playlist Mode's one-shot playlist mailbox, this one is a live socket to
 * a Cloudflare room. Same idea of "scan a code, join on your phone", completely
 * different lifetime — overloading one route with both would mean one page
 * guessing which kind of room a code refers to.
 */

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BuzzerButton } from "@/components/buzzer-button";
import { useBuzzerSocket } from "@/lib/use-buzzer-socket";
import { trackEvent } from "@/lib/analytics";

const NAME_STORAGE_KEY = "guesssong_player_name";

export default function BuzzPlayerPage() {
  const params = useParams<{ code: string }>();
  const code = (params.code ?? "").toUpperCase();

  const [name, setName] = useState("");
  const [draft, setDraft] = useState("");
  const [ready, setReady] = useState(false);

  // Remember the name so a reconnect (or a locked phone coming back) doesn't
  // dump the player onto a form mid-round.
  useEffect(() => {
    const saved = window.localStorage.getItem(NAME_STORAGE_KEY);
    if (saved) {
      setDraft(saved);
      setName(saved);
      setReady(true);
    }
  }, []);

  const joinedRef = useRef(false);
  const { snapshot, connected, error, playerId, buzz } = useBuzzerSocket({
    code: ready ? code : null,
    name,
  });

  useEffect(() => {
    if (!snapshot || joinedRef.current) return;
    joinedRef.current = true;
    trackEvent("buzz_player_joined", { player_count: snapshot.players.length });
  }, [snapshot]);

  function handleJoin() {
    const trimmed = draft.trim();
    if (!trimmed) return;
    window.localStorage.setItem(NAME_STORAGE_KEY, trimmed);
    setName(trimmed);
    setReady(true);
  }

  if (!ready) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background p-6 text-foreground">
        <div className="flex w-full max-w-sm flex-col gap-4">
          <div>
            <h1 className="text-2xl font-bold">加入 {code}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              輸入名字,主持人的畫面上會顯示是誰搶到。
            </p>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="name">你的名字</Label>
            <Input
              id="name"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleJoin()}
              placeholder="小明"
              maxLength={24}
              autoFocus
            />
          </div>
          <Button onClick={handleJoin} disabled={!draft.trim()}>
            進房間
          </Button>
        </div>
      </main>
    );
  }

  // name_taken and room_expired are dead ends — retrying the same socket will
  // fail the same way, so send the player back to the form rather than leaving
  // them staring at a button that will never work.
  const fatal = error && (error.code === "name_taken" || error.code === "room_expired");
  if (fatal) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background p-6 text-foreground">
        <div className="flex w-full max-w-sm flex-col gap-4 text-center">
          <p className="text-lg font-semibold text-destructive">{error.message}</p>
          <Button
            variant="secondary"
            onClick={() => {
              window.localStorage.removeItem(NAME_STORAGE_KEY);
              setReady(false);
              joinedRef.current = false;
            }}
          >
            換個名字再試
          </Button>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-[100dvh] flex-col gap-3 bg-background p-3 text-foreground">
      <header className="flex items-center justify-between px-1 text-sm">
        <span className="font-semibold">{name}</span>
        <span className="text-muted-foreground">
          {connected ? `房間 ${code}` : "連線中…"}
          {snapshot ? ` · ${snapshot.players.length} 人` : ""}
        </span>
      </header>

      <BuzzerButton
        phase={snapshot?.phase ?? "idle"}
        buzzes={snapshot?.buzzes ?? []}
        playerId={playerId}
        connected={connected}
        onBuzz={buzz}
      />

      <p className="px-1 pb-1 text-center text-xs text-muted-foreground">
        把手機拿好,歌一放就按。答案用喊的。
      </p>
    </main>
  );
}
