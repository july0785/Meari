import { app } from 'electron';
import { join } from 'node:path';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

export interface Config {
  pollIntervalMs: number;
  discordClientId?: string; // 비우면 constants.ts 의 기본값 사용
  disableGpu?: boolean;     // 화면이 깜빡이는 환경에서만 true (CPU 사용량이 크게 늘어남)
  rawTitle?: boolean;       // true 면 제목 정리(태그·병기·번역 꼬리 제거)를 끄고 원제목 그대로 표시
  videoCover?: 'scenery' | 'crop'; // 영상(16:9) 썸네일 처리: 풍경 이미지 대체(기본) / 스마트 크롭
}
const DEFAULTS: Config = { pollIntervalMs: 3000 };

const file = () => join(app.getPath('userData'), 'config.json');

export function loadConfig(): Config {
  try {
    if (existsSync(file())) {
      return { ...DEFAULTS, ...JSON.parse(readFileSync(file(), 'utf-8')) };
    }
  } catch { /* 기본값 */ }
  return DEFAULTS;
}

export function saveConfig(patch: Partial<Config>): void {
  writeFileSync(file(), JSON.stringify({ ...loadConfig(), ...patch }, null, 2));
}
