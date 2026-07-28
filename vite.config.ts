import { defineConfig } from "vite-plus";

export default defineConfig({
  fmt: {},
  lint: {
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
    rules: { "vite-plus/prefer-vite-plus-imports": "error" },
    options: { typeAware: true, typeCheck: true },
  },
  run: {
    cache: true,
    tasks: {
      "prototype:evidence-store": {
        command: "node tools/evidence-store-prototype/probe.ts",
        cache: false,
      },
      "prototype:evidence-search": {
        command: "node tools/evidence-search-prototype/tui.ts",
        cache: false,
      },
    },
  },
});
