import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "markdown",
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
