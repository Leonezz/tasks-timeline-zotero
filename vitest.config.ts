import { defineConfig } from "vitest/config";

// Pure-logic unit tests in Node. Zotero integration tests live in test/ and
// run through `pnpm test` (zotero-plugin-scaffold).
export default defineConfig({
  test: {
    include: ["unit/**/*.test.ts"],
    environment: "node",
  },
});
