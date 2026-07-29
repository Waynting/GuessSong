import { defineConfig } from "vitest/config";
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";

// Runs the tests inside workerd against the real Durable Object, not a mock.
// A fake would defeat the point: the property under test is the runtime's
// single-threaded execution guarantee, which is precisely what a mock invents.
//
// vitest-pool-workers >= 0.19 (Vitest 4) exposes this as a Vite plugin; the old
// `defineWorkersConfig` + `poolOptions.workers` shape is gone.
export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      // Isolated storage stacks and unwinds the DO's SQLite between suites, and
      // asserts on a clean .sqlite path. An open WebSocket keeps the object
      // alive past teardown, leaving a -shm file behind and blowing that
      // assertion (the documented known issue). Every test here mints a fresh
      // random room code, so there is nothing to isolate from anyway.
      isolatedStorage: false,
    }),
  ],
});
