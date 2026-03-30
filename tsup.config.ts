import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: {
      index: "src/index.ts",
      react: "src/react.tsx"
    },
    format: ["esm", "cjs"],
    dts: true,
    sourcemap: true,
    clean: true,
    splitting: false,
    minify: false,
    target: "es2022"
  }
]);
