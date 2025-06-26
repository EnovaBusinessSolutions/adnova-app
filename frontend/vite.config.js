// frontend/vite.config.js
import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',                       // raíz de "frontend"
  build: {
    outDir: '../public/connector', // deja el bundle junto a tu interface.html
    emptyOutDir: false,            // no borra otros archivos en la carpeta destino
    rollupOptions: {
      input: 'interface.js',     // el único archivo de entrada (entry)
      output: {
        entryFileNames: 'interface.bundle.js' // nombre fijo para que no tengas que editar el HTML nunca
      }
    }
  }
});
