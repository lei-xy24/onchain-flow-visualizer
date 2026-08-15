// Runtime bindings supplied by the hosting platform.
// Keep names in sync with .openai/hosting.json and worker/index.ts.
declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
  }
}
