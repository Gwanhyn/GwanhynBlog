import { defineConfig } from "vite";

export default defineConfig({
  base: process.env.VITE_BASE ?? "./",
  esbuild: {
    target: "esnext"
  },
  optimizeDeps: {
    esbuildOptions: {
      target: "esnext"
    }
  },
  build: {
    target: "esnext"
  }
});
