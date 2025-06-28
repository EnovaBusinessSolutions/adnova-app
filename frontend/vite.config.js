
import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',                       
  build: {
    outDir: '../public/connector', 
    emptyOutDir: false,            
    rollupOptions: {
      input: 'interface.js',     
      output: {
        entryFileNames: 'interface.bundle.js' 
      }
    }
  }
});
