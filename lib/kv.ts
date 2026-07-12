/**
 * Minimal KV abstraction for Mixed Playlist Mode's room store. Uses Upstash
 * Redis (via UPSTASH_REDIS_REST_URL/TOKEN) when configured; otherwise falls
 * back to an in-process Map so local dev and tests don't need a real Redis
 * instance. The in-memory fallback only survives within a single Node
 * process — fine for `next dev`/`next start`, but NOT safe for multi-instance
 * serverless deploys, which is why production must set the Upstash env vars.
 */

export interface KvStore {
  get<T>(key: string): Promise<T | null>;
  set(key: string, value: unknown, ttlSeconds: number): Promise<void>;
  del(key: string): Promise<void>;
  /**
   * Atomically increments a counter and (re)starts its TTL on the first
   * increment of a window. Used for rate limiting, where a get-then-set
   * pair would race under concurrent requests.
   */
  incr(key: string, ttlSeconds: number): Promise<number>;
}

type MemoryEntry = { value: unknown; expiresAt: number };

declare global {
  // eslint-disable-next-line no-var -- global singleton, see getMemoryMap below
  var __guesssongKvMemoryStore: Map<string, MemoryEntry> | undefined;
}

/**
 * Next.js dev mode compiles each API route file as a separate on-demand
 * bundle — a plain module-scope `Map` ends up as a distinct instance per
 * route the first time it's compiled, so a room created via POST /api/room
 * would be invisible to GET /api/room/[code]/status. Stashing the Map on
 * `globalThis` (the real, single Node.js global) sidesteps that, the same
 * way Prisma's dev-mode client singleton does.
 */
function getMemoryMap(): Map<string, MemoryEntry> {
  if (!globalThis.__guesssongKvMemoryStore) {
    globalThis.__guesssongKvMemoryStore = new Map();
  }
  return globalThis.__guesssongKvMemoryStore;
}

function createMemoryStore(): KvStore {
  return {
    async get<T>(key: string) {
      const store = getMemoryMap();
      const entry = store.get(key);
      if (!entry) return null;
      if (Date.now() > entry.expiresAt) {
        store.delete(key);
        return null;
      }
      return entry.value as T;
    },
    async set(key, value, ttlSeconds) {
      getMemoryMap().set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
    },
    async del(key) {
      getMemoryMap().delete(key);
    },
    async incr(key, ttlSeconds) {
      const store = getMemoryMap();
      const entry = store.get(key);
      const now = Date.now();
      if (!entry || now > entry.expiresAt) {
        store.set(key, { value: 1, expiresAt: now + ttlSeconds * 1000 });
        return 1;
      }
      const next = (entry.value as number) + 1;
      store.set(key, { value: next, expiresAt: entry.expiresAt });
      return next;
    },
  };
}

function hasUpstashEnv(): boolean {
  return Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
}

let upstashStore: KvStore | null = null;

async function getUpstashStore(): Promise<KvStore> {
  if (!upstashStore) {
    const { Redis } = await import("@upstash/redis");
    const redis = Redis.fromEnv();
    upstashStore = {
      async get<T>(key: string) {
        return (await redis.get<T>(key)) ?? null;
      },
      async set(key, value, ttlSeconds) {
        await redis.set(key, value, { ex: ttlSeconds });
      },
      async del(key) {
        await redis.del(key);
      },
      async incr(key, ttlSeconds) {
        const count = await redis.incr(key);
        // Only the request that started this window sets its expiry, so
        // later increments don't keep pushing the TTL back.
        if (count === 1) await redis.expire(key, ttlSeconds);
        return count;
      },
    };
  }
  return upstashStore;
}

const memoryStore = createMemoryStore();

/** Returns the Upstash-backed store when configured, else the in-memory fallback. */
export async function getKvStore(): Promise<KvStore> {
  return hasUpstashEnv() ? getUpstashStore() : memoryStore;
}
