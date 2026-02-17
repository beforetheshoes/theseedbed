import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  use: {
    baseURL: "http://localhost:3001",
    trace: "on-first-retry",
  },
  webServer: {
    command:
      "NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321 NEXT_PUBLIC_SUPABASE_ANON_KEY=test-anon-key NEXT_PUBLIC_API_BASE_URL=http://localhost:8000 pnpm dev",
    port: 3001,
    reuseExistingServer: true,
    timeout: 120000,
  },
});
