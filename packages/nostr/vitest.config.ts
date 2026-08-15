import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "nostr",
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
