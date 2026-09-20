import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// base: "/" works for a custom domain (e.g. kaalgeplukt.nl) or any root host.
// If you serve from a subpath like username.codeberg.page/kaalgeplukt,
// change this to "/kaalgeplukt/".
export default defineConfig({
  base: "/",
  plugins: [react()],
});
