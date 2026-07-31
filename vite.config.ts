import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // Vite refuses requests whose Host header it does not recognise (DNS
      // rebinding protection), answering 403 "Blocked request. This host is
      // not allowed." In-cluster dev is reached through Traefik as
      // kiroku-dev.in.neovara.uk, so that host has to be allow-listed.
      //
      // Env-driven rather than hardcoded: the hostname is a property of where
      // this is deployed, not of the app. dev-deploy/frontend.yaml sets it.
      // Empty default = unchanged behaviour for local/Compose/CI use.
      allowedHosts: process.env.VITE_ALLOWED_HOSTS?.split(',') ?? [],
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
