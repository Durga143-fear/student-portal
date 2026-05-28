import { defineConfig } from "vite";

export default defineConfig({
  envPrefix: ["SUPABASE_", "VITE_SUPABASE_"],
});
