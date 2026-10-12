import { createRequire } from "node:module";
import path from "node:path";
import { defineConfig } from "zotero-plugin-scaffold";
import pkg from "./package.json";

const require = createRequire(import.meta.url);
const packageDir = (name: string) =>
  path.dirname(require.resolve(`${name}/package.json`));

// Zotero 9 and 10 both run on Firefox 140 ESR.
const GECKO_TARGET = "firefox140";
const nodeEnv = process.env.NODE_ENV ?? "production";

export default defineConfig({
  source: ["src", "addon"],
  dist: ".scaffold/build",
  name: pkg.config.addonName,
  id: pkg.config.addonID,
  namespace: pkg.config.addonRef,
  updateURL: `https://github.com/{{owner}}/{{repo}}/releases/download/release/${
    pkg.version.includes("-") ? "update-beta.json" : "update.json"
  }`,
  xpiDownloadLink:
    "https://github.com/{{owner}}/{{repo}}/releases/download/v{{version}}/{{xpiName}}.xpi",

  build: {
    assets: ["addon/**/*.*"],
    define: {
      ...pkg.config,
      author: pkg.author,
      description: pkg.description,
      homepage: pkg.homepage,
      buildVersion: pkg.version,
      buildTime: "{{buildTime}}",
    },
    prefs: {
      prefix: pkg.config.prefsPrefix,
    },
    esbuildOptions: [
      // Plugin core: runs in the bootstrap sandbox, talks to Zotero APIs.
      {
        entryPoints: ["src/index.ts"],
        define: {
          __env__: `"${nodeEnv}"`,
        },
        bundle: true,
        target: GECKO_TARGET,
        outfile: `.scaffold/build/addon/content/scripts/${pkg.config.addonRef}.js`,
      },
      // UI: React app, loaded into the main window scope so React sees real
      // DOM globals (window, document, MessageChannel, ...). Exposes a single
      // global that the core removes on shutdown.
      {
        entryPoints: ["src/ui/index.tsx"],
        define: {
          __env__: `"${nodeEnv}"`,
          "process.env.NODE_ENV": `"${nodeEnv}"`,
        },
        bundle: true,
        format: "iife",
        globalName: `__${pkg.config.addonRef}_ui__`,
        jsx: "automatic",
        // Two copies of React break hooks. Always bundle this project's copy,
        // even when the component library resolves its own (e.g. pnpm link).
        alias: {
          react: packageDir("react"),
          "react-dom": packageDir("react-dom"),
        },
        minify: nodeEnv === "production",
        loader: { ".css": "text" },
        target: GECKO_TARGET,
        outfile: `.scaffold/build/addon/content/scripts/${pkg.config.addonRef}-ui.js`,
      },
    ],
  },

  server: {
    createProfileIfMissing: true,
    // Writes Zotero debug output to logs/ so mount diagnostics are inspectable.
    debugOutputFile: true,
  },

  test: {
    waitForPlugin: `() => Zotero.${pkg.config.addonInstance}.data.initialized`,
  },
});
