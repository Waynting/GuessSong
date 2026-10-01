import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ServerMessage } from "@/lib/buzzer-protocol";
import { useBuzzerSocket, type BuzzerSocketApi } from "@/lib/use-buzzer-socket";

/**
 * Drives the real hook against a scripted socket. Every other buzzer test
 * pins this file by reading its source; the reconnect schedule is behaviour
 * across several events and timers, which a regex cannot see.
 */
class FakeSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static all: FakeSocket[] = [];
  readyState = FakeSocket.CONNECTING;
  sent: string[] = [];
  private listeners = new Map<string, ((e: unknown) => void)[]>();
  constructor(public url: string) {
    FakeSocket.all.push(this);
  }
  addEventListener(type: string, fn: (e: unknown) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  private fire(type: string, e: unknown = {}) {
    for (const fn of this.listeners.get(type) ?? []) fn(e);
  }
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    if (this.readyState === FakeSocket.CLOSED) return;
    this.readyState = FakeSocket.CLOSED;
    this.fire("close");
  }
  serverOpen() {
    this.readyState = FakeSocket.OPEN;
    this.fire("open");
  }
  serverSend(msg: ServerMessage) {
    this.fire("message", { data: JSON.stringify(msg) });
  }
  /** Refused at the upgrade: the socket closes without ever opening. */
  serverRefuse() {
    this.readyState = FakeSocket.CLOSED;
    this.fire("close");
  }
}

let root: Root | null = null;
let api: BuzzerSocketApi | null = null;

function Harness() {
  api = useBuzzerSocket({ code: "AB7K", name: "Ann" });
  return null;
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  process.env.NEXT_PUBLIC_BUZZER_WS_URL = "wss://buzzer.example.workers.dev";
  FakeSocket.all = [];
  vi.stubGlobal("WebSocket", FakeSocket);
  vi.useFakeTimers();
  const host = document.createElement("div");
  root = createRoot(host);
  act(() => root!.render(createElement(Harness)));
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  api = null;
  vi.useRealTimers();
  vi.unstubAllGlobals();
  delete process.env.NEXT_PUBLIC_BUZZER_WS_URL;
});

describe("useBuzzerSocket after the room expires", () => {
  it("keeps room_expired and opens no further socket", () => {
    expect(FakeSocket.all).toHaveLength(1);
    const ws = FakeSocket.all[0];
    act(() => ws.serverOpen());
    act(() => ws.serverSend({ type: "error", code: "room_expired", message: "This room has expired" }));
    act(() => ws.close());

    // Long past the 30s ceiling, several times over, with the Worker refusing
    // every upgrade for the dead room the way it does (a 404 at the upgrade).
    for (let i = 0; i < 10; i++) {
      act(() => vi.advanceTimersByTime(30_000));
      for (const s of FakeSocket.all) if (s.readyState === FakeSocket.CONNECTING) act(() => s.serverRefuse());
    }
    expect(api!.error?.code).toBe("room_expired");
    expect(FakeSocket.all).toHaveLength(1);
    expect(api!.connected).toBe(false);
  });

  it("still lets reconnect() try again from a clean socket", () => {
    const ws = FakeSocket.all[0];
    act(() => ws.serverOpen());
    act(() => ws.serverSend({ type: "error", code: "room_expired", message: "This room has expired" }));
    act(() => ws.close());

    act(() => api!.reconnect());
    expect(FakeSocket.all).toHaveLength(2);
    expect(api!.error).toBeNull();
    // A fresh run retries as before: the expiry belonged to the old one.
    act(() => FakeSocket.all[1].serverRefuse());
    act(() => vi.advanceTimersByTime(1_000));
    expect(FakeSocket.all).toHaveLength(3);
  });

  it("still retries a connection that dropped for any other reason", () => {
    const ws = FakeSocket.all[0];
    act(() => ws.serverOpen());
    act(() => ws.serverSend({ type: "error", code: "not_joined", message: "Send a join message first" }));
    act(() => ws.close());
    act(() => vi.advanceTimersByTime(1_000));
    expect(FakeSocket.all).toHaveLength(2);
  });
});
