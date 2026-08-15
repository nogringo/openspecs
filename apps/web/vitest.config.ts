import { defineConfig } from "vitest/config";

// The React Router Vite plugin is deliberately left out: it expects a route module
// graph that unit tests do not go through.
export default defineConfig({
  test: {
    name: "web",
    environment: "node",
    include: ["app/**/*.test.{ts,tsx}"],
  },
});
