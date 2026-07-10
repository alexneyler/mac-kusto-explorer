import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

// Dedicated Vitest config (kept separate from the Tauri-tuned vite.config.ts).
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    css: false,
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/**/*.{test,spec}.{ts,tsx}", "src/test/**", "src/main.tsx"],
    },
  },
  resolve: {
    alias: {
      // The Monaco editor pulls in browser workers that jsdom can't load; component
      // tests mock the editor module, so this alias only guards accidental imports.
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
