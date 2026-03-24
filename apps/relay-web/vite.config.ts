import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import type { Plugin } from "vite";
import { defineConfig, loadEnv } from "vite";

const appRoot = path.dirname(fileURLToPath(import.meta.url));
const installScriptPath = path.resolve(appRoot, "../../install.sh");

function relayInstallScriptPlugin(): Plugin {
  return {
    name: "relay-install-script",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if ((req.url || "").split("?")[0] !== "/install.sh") {
          next();
          return;
        }

        res.statusCode = 200;
        res.setHeader("content-type", "text/x-shellscript; charset=utf-8");
        res.end(fs.readFileSync(installScriptPath, "utf8"));
      });
    },
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "install.sh",
        source: fs.readFileSync(installScriptPath, "utf8"),
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, appRoot, "");
  const apiTarget = env.VITE_DEV_API_TARGET || "http://localhost:3100";

  return {
    envDir: appRoot,
    plugins: [react(), relayInstallScriptPlugin()],
    server: {
      proxy: {
        "/api": {
          target: apiTarget,
          changeOrigin: true,
        },
        "/ws": {
          target: apiTarget,
          ws: true,
        },
      },
    },
  };
});
