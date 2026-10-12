import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [vue()],
  server: {
    host: "localhost",
    port: 5173,
    strictPort: true,
    // Le navigateur parle à une seule adresse (localhost:5173) ; Vite relaie /api vers le serveur.
    proxy: {
      "/api": { target: "http://127.0.0.1:3000", changeOrigin: false },
    },
  },
});
