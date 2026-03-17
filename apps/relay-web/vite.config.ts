import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": {
        target: process.env.VITE_DEV_API_TARGET || "http://localhost:3100",
        changeOrigin: true,
      },
      "/ws": {
        target: process.env.VITE_DEV_API_TARGET || "http://localhost:3100",
        ws: true,
      },
    },
  },
});
