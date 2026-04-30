import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["cjs"],
  target: "node20",
  splitting: false,
  clean: true,
  // Bundle dt-eval-lib so the Lambda artifact is self-contained
  // (workspace deps won't resolve inside a Docker build without a full monorepo install)
  noExternal: ["@dynatrace-oss/dt-eval-lib"],
  // CJS output so Lambda can import it without ESM config
  outExtension: () => ({ js: ".js" }),
});
