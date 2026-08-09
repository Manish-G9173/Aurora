import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// On Zerops static hosting, __API_URL__ is substituted by the platform's
// envReplace feature from the API_URL variable in service secrets. When
// building locally without VITE_API_URL, the literal placeholder "__API_URL__"
// is emitted into the bundle so that envReplace can replace it at deploy.
const API_URL = process.env.VITE_API_URL ?? "__API_URL__";
const FINAL_URL = process.env.VITE_API_URL
  ? JSON.stringify(process.env.VITE_API_URL)
  : JSON.stringify("__API_URL__");

export default defineConfig({
  plugins: [react()],
  define: {
    __API_URL__: FINAL_URL,
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:8000",
    },
  },
});
