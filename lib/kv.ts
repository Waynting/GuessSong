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
  /**
   * Reads many keys as one command, in the order given, with null for each
   * key that isn't present.
   *
   * Exists for app/api/preview/batch/route.ts, where a 50-track game would
   * otherwise be 50 separate round trips. Upstash bills per command, so that
   * is a 50x difference on the one quota this app actually pays for — and the
   * whole point of the batch route is to make a game cost a fixed, small
   * number of calls rather than a number that scales with the playlist.
   */
  mget<T>(keys: string[]): Promise<Array<T | null>>;
  set(key: string, value: unknown, ttlSeconds: number): Promise<void>;
  del(key: string): Promise<void>;
  /**
   * Atomically increments a counter and (re)starts its TTL on the first
   * increment of a window. Used for rate limiting, where a get-then-set
   * pair would race under concurrent requests.
   *
   * `by` lets a caller that already knows it is recording N events spend one
   * command instead of N. Without it the batch route's own hit counter would
   * undo the saving `mget` just made.
   */
  incr(key: string, ttlSeconds: number, by?: number): Promise<number>;
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
  const store: KvStore = {
    async get<T>(key: string) {
      const map = getMemoryMap();
      const entry = map.get(key);
      if (!entry) return null;
      if (Date.now() > entry.expiresAt) {
        map.delete(key);
        return null;
      }
      return entry.value as T;
    },
    async mget<T>(keys: string[]) {
      return Promise.all(keys.map((key) => store.get<T>(key)));
    },
    async set(key, value, ttlSeconds) {
      getMemoryMap().set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
    },
    async del(key) {
      getMemoryMap().delete(key);
    },
    async incr(key, ttlSeconds, by = 1) {
      const map = getMemoryMap();
      const entry = map.get(key);
      const now = Date.now();
      if (!entry || now > entry.expiresAt) {
        map.set(key, { value: by, expiresAt: now + ttlSeconds * 1000 });
        return by;
      }
      const next = (entry.value as number) + by;
      map.set(key, { value: next, expiresAt: entry.expiresAt });
      return next;
    },
  };
  return store;
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
      async mget<T>(keys: string[]) {
        // Redis errors on MGET with no keys, and a caller with nothing to look
        // up is normal here (a batch where every track was already resolved
        // in this session).
        if (keys.length === 0) return [];
        const values = await redis.mget<Array<T | null>>(...keys);
        // Upstash returns a sparse-free array, but a shorter one would silently
        // misalign results with the keys the caller sent — pad rather than let
        // that become a wrong preview URL on the wrong track.
        return keys.map((_, i) => values?.[i] ?? null);
      },
      async set(key, value, ttlSeconds) {
        await redis.set(key, value, { ex: ttlSeconds });
      },
      async del(key) {
        await redis.del(key);
      },
      async incr(key, ttlSeconds, by = 1) {
        const count = by === 1 ? await redis.incr(key) : await redis.incrby(key, by);
        // Only the request that started this window sets its expiry, so
        // later increments don't keep pushing the TTL back. `count === by`
        // rather than `=== 1`: a batch that opens a window with +12 is still
        // the first increment of it.
        if (count === by) await redis.expire(key, ttlSeconds);
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
