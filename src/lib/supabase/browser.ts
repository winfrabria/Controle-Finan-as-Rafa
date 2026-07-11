import { createBrowserClient } from "@supabase/ssr";

import { getSupabaseConfig } from "./config";

export function createClient() {
  const { supabaseUrl, supabaseAnonKey } = getSupabaseConfig();

  return createBrowserClient(supabaseUrl, supabaseAnonKey);
}
