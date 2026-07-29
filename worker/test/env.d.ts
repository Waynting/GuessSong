/// <reference types="@cloudflare/vitest-pool-workers/types" />

// Types the `env` handed to tests as this Worker's real bindings, so a test that
// reaches for a binding that isn't in wrangler.jsonc fails at compile time
// rather than at 3am in someone's living room.
declare module "cloudflare:test" {
  interface ProvidedEnv extends Env {}
}
