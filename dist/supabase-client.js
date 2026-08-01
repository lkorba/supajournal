// supabase-client.js
// ------------------------------------------------------------------
// Single, lazily-constructed Supabase client. Both auth.js and db.js
// import from here so we have one auth/connection per page load.
//
// SECURITY:
//   - The anon key is safe to ship in JS. The service_role key is NOT,
//     and we never import it.
//   - In mock mode this module returns null; consumers must fall back
//     to their mock paths.
// ------------------------------------------------------------------

import { config, isMockMode } from "./config.js";

let _client = null;
let _createClient = null;

export async function getSupabaseClient() {
  if (isMockMode) return null;
  if (_client) return _client;
  if (!_createClient) {
    const mod = await import(
      "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm"
    );
    _createClient = mod.createClient;
  }
  _client = _createClient(config.url, config.anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  });
  return _client;
}

// Re-export the live client promise for modules that just want to call
// methods. Kept as a property for the auth.js dynamic-import pattern.
export const supabase = {
  get client() {
    return _client;
  },
  whenReady: getSupabaseClient,
};
