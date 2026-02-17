import { defineConfig } from "vitest/config";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/tests/setup/vitest.setup.ts"],
    include: ["src/tests/unit/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/lib/**/*.ts"],
      exclude: ["src/lib/supabase/**/*.ts"],
      thresholds: {
        lines: 95,
        statements: 95,
        functions: 95,
        branches: 95,
        perFile: true,
      },
    },
  },
});
