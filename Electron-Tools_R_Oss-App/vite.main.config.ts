import { defineConfig } from 'vite';

// https://vitejs.dev/config
export default defineConfig({
    build: {
        rollupOptions: {
            // Treat optional native deps for "ws" as external so they are
            // required at runtime (and can be absent) instead of being bundled.
            external: ['bufferutil', 'utf-8-validate'],
        },
    },
});
