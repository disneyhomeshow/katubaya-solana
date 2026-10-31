import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  // The Codama client reads process.env.NODE_ENV to pick verbose error messages.
  define: { "process.env.NODE_ENV": JSON.stringify(mode === "production" ? "production" : "development") },
}));
