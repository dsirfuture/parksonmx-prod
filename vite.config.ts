import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(), // ✅ Tailwind v4 必须
  ],
  server: {
    port: 3000,
    proxy: {
      "/api": {
        target: "https://parksonmx.vercel.app",
        changeOrigin: true,
        secure: true,
      },
    },
  },
});