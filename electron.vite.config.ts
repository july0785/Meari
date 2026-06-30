import { defineConfig } from 'electron-vite';
import { resolve } from 'node:path';

export default defineConfig({
  main:    { build: { lib: { entry: resolve(__dirname, 'src/main/index.ts') } } },
  preload: { build: { lib: { entry: resolve(__dirname, 'src/preload/index.ts') } } },
  // 렌더러 없음: music.youtube.com 을 직접 띄움.
  // electron-vite 가 렌더러 없음으로 오류를 내면 빈 renderer 항목을 최소로 추가.
});
