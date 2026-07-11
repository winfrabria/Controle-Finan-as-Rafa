import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let storageAdminClient: SupabaseClient | undefined;

function requireServerEnvironmentVariable(name: string) {
  const value = process.env[name];

  if (!value || value.startsWith("replace-with")) {
    throw new Error(`${name} is required for server-side Storage operations.`);
  }

  return value;
}

export function getStorageAdminClient() {
  if (storageAdminClient) {
    return storageAdminClient;
  }

  const supabaseUrl = requireServerEnvironmentVariable(
    "NEXT_PUBLIC_SUPABASE_URL",
  );
  const serviceRoleKey = requireServerEnvironmentVariable(
    "SUPABASE_SERVICE_ROLE_KEY",
  );

  storageAdminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });

  return storageAdminClient;
}
