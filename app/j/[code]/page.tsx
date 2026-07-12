"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type SubmitStatus = "idle" | "loading" | "done" | "error";

export default function JoinRoomPage() {
  const params = useParams<{ code: string }>();
  const code = (params.code ?? "").toUpperCase();

  const [name, setName] = useState("");
  const [playlistUrl, setPlaylistUrl] = useState("");
  const [status, setStatus] = useState<SubmitStatus>("idle");
  const [trackCount, setTrackCount] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const isValidUrl =
    playlistUrl.includes("spotify.com/playlist") || playlistUrl.includes("spotify:playlist:");
  const canSubmit = name.trim().length > 0 && isValidUrl && status !== "loading";

  async function handleSubmit() {
    if (!canSubmit) return;
    setStatus("loading");
    setError(null);
    try {
      const res = await fetch(`/api/room/${code}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playerName: name, playlistUrl }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Couldn't submit your playlist");
      setTrackCount(data.trackCount);
      setStatus("done");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      setStatus("error");
    }
  }

  if (status === "done") {
    return (
      <main className="min-h-screen flex items-center justify-center p-6 bg-background text-foreground">
        <Card className="w-full max-w-sm text-center">
          <CardHeader>
            <CardTitle className="text-[#1DB954]">✓ You&apos;re in!</CardTitle>
            <CardDescription>
              Received {trackCount} track{trackCount === 1 ? "" : "s"} from your playlist.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              You can close this page now — the host will start the game once everyone&apos;s in.
              No one else can see your playlist.
            </p>
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-6 bg-background text-foreground">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Join Room {code}</CardTitle>
          <CardDescription>
            Add your Spotify playlist — no one else will see it until the game starts.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="name">Your Name</Label>
            <Input
              id="name"
              placeholder="Player name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={24}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="playlist">Your Spotify Playlist</Label>
            <Input
              id="playlist"
              type="url"
              placeholder="https://open.spotify.com/playlist/..."
              value={playlistUrl}
              onChange={(e) => setPlaylistUrl(e.target.value)}
              spellCheck={false}
            />
          </div>
          <Button onClick={handleSubmit} disabled={!canSubmit}>
            {status === "loading" ? "Submitting..." : "Submit Playlist"}
          </Button>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </CardContent>
      </Card>
    </main>
  );
}
