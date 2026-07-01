import { defineConfig } from 'electron-vite';
import { resolve } from 'node:path';

export default defineConfig({
  main:    { build: { lib: { entry: resolve(__dirname, 'src/main/index.ts') } } },
  preload: { build: { lib: { entry: resolve(__dirname, 'src/preload/index.ts') } } },
  // 렌더러는 제목표시줄(로고 + 창 버튼)만 담는다. 유튜브뮤직은 WebContentsView 로 별도 적재.
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    build: {
      rollupOptions: { input: resolve(__dirname, 'src/renderer/index.html') },
    },
  },
});
