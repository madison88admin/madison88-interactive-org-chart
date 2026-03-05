import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
var buildId = new Date().toISOString();
export default defineConfig({
    plugins: [react()],
    define: {
        __APP_BUILD_ID__: JSON.stringify(buildId)
    },
    server: {
        port: 5173,
    },
});
