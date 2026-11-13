import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { copyFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

// VITE_BASE_PATH: sitenin yayınlandığı alt dizin. GitHub Pages iş akışı bunu otomatik verir
// ("/<depo>/" veya özel alan adı / kullanici.github.io deposu için "/").
const base = (process.env.VITE_BASE_PATH ?? "/").replace(/\/?$/, "/");

export default defineConfig({
  base,
  plugins: [
    react(),
    tailwindcss(),
    {
      // GitHub Pages bilinmeyen yollar için 404.html sunar; index.html'in kopyası
      // sayesinde /gorevler/<id> gibi adresler yenilendiğinde de uygulama açılır.
      name: "spa-404-fallback",
      apply: "build",
      closeBundle() {
        const index = resolve("dist/index.html");
        if (existsSync(index)) copyFileSync(index, resolve("dist/404.html"));
      },
    },
  ],
  server: { port: 5173, host: "127.0.0.1" },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/recharts") || id.includes("node_modules/d3-")) return "charts";
          if (id.includes("node_modules/@supabase")) return "supabase";
        },
      },
    },
  },
});
