import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Unit tests: no keys, no network, no PayPal. They run in CI on every push.
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: { environment: "node", include: ["src/**/*.test.ts"] },
});
