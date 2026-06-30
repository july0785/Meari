# 메아리(Maeari) — 개발지시서 (Claude Code 용)

> 이 문서는 Claude Code가 처음부터 끝까지 보고 그대로 만들 수 있게 쓴 지시서이다.
> 결과물은 깃헙에 **MIT** 로 공개한다. 아래 결정사항은 임의로 바꾸지 말 것.

---

## ０. 한줄요약

일렉트론 데스크탑 응용프로그람 하나를 만든다. 창 안에서 `music.youtube.com` 을 띄우고,
지금 듣는 곡정보를 읽어, 그것을 디스코드 Rich Presence(제목·가수·앨범그림·진행띠)로 띄운다.
브라우저 확장도 native host도 쓰지 않는다 — 전부 한 프로그람 안에서 끝낸다.

## １. 만드는 범위

들어가는 것:
- `music.youtube.com` 을 적재하는 단일 창
- 구글 로그인 유지(세션 지속)
- 지금 재생곡 읽기(제목·가수·앨범·앨범그림·경과/총 시간·일시정지 여부)
- 디스코드 Rich Presence 갱신(곡 바뀔 때만)
- 트레이 상주(닫기 → 숨김, 종료는 트레이 메뉴)

안 들어가는 것(초기판 제외):
- 자체 재생 UI(유튜브뮤직 웹을 그대로 쓴다)
- 가사·다운로드·테마 따위 부가기능
- 별도 설정창(설정은 `config.json` + 트레이로 충분)

## ２. 확정된 기술결정 (변경금지)

- 언어: **TypeScript**
- 골격: **Electron** (최신 안정판)
- 빌드: **electron-vite** (개발/번들) + **electron-builder** (포장)
- 디스코드: **`@xhayper/discord-rpc`** (구 `discord-rpc` 의 유지보수 TS 갈래)
- 렌더러 없음: 외부 사이트를 직접 적재하므로 자체 렌더러 HTML은 만들지 않는다(main + preload 만).
- 상태저장: 브라우저 storage(localStorage 등) 쓰지 말 것. 설정은 `userData/config.json`.

> Pear Desktop 을 fork 하지 말 것. 그건 플라그인 덩어리라 필요한 핵심이 묻힌다. 최소 앱을 새로 짠다.

## ３. 프로젝트 구조

```
maeari/
├── src/
│   ├── main/
│   │   ├── index.ts        # 앱 진입: 창·수명주기·트레이
│   │   ├── presence.ts     # discord-rpc 연결 + setActivity
│   │   ├── reader.ts        # executeJavaScript 로 곡정보 읽기
│   │   ├── config.ts        # userData/config.json 읽기/쓰기
│   │   └── constants.ts     # Client ID, URL, 폴링간격
│   └── preload/
│       └── index.ts         # 거의 빈 파일(추후 설정창용)
├── resources/
│   └── icon.png             # 트레이/앱 아이콘
├── electron.vite.config.ts
├── electron-builder.yml
├── tsconfig.json
├── package.json
├── .gitignore
├── LICENSE                  # MIT
└── README.md
```

## ４. 동작 흐름 (핵심 로직)

### ４.１ 창 생성 & 페지 적재
- `BrowserWindow` 로 `music.youtube.com` 을 `loadURL` 한다.
- `webPreferences.partition = 'persist:main'` 로 로그인/쿠키를 재시작 후에도 유지.
- `contextIsolation: true`, `nodeIntegration: false` (보안 기본값 유지).

### ４.２ 로그인 / User-Agent / 세션
- 일렉트론 기본 UA에는 `Electron/…` 토큰이 들어있어 구글 로그인이 막힌다.
  → UA에서 `Electron/x.y.z` 와 앱이름 토큰을 제거해 Chrome 처럼 보이게 한다.
- 구글 OAuth는 팝업창으로 뜨므로 `setWindowOpenHandler` 로 팝업을 허용하고 같은 세션을 쓰게 한다.
- 그래도 《이 브라우저는 안전하지 않을 수 있습니다》가 뜨면, 최신 Chrome 데스크탑 UA 전체문자렬을 박는다.

### ４.３ 재생정보 읽기 (reader)
- 유튜브뮤직은 `navigator.mediaSession.metadata` 에 제목·가수·앨범·앨범그림배렬을 채운다.
- 단, MediaSession은 페지의 **본래(main) world** 에 있어 격리된 preload에서는 직접 안 보인다.
  → main에서 `webContents.executeJavaScript()` 로 본래 world 값을 읽는다(IPC 배선 불필요).
- 진행시간은 페지의 `<video>` 요소에서 `currentTime`/`duration`/`paused` 로 얻는다.
- `executeJavaScript` 가 던질 수 있으니(페지 이동중 등) 반드시 try/catch → 실패시 null.

### ４.４ 디스코드 presence (presence)
- `@xhayper/discord-rpc` 의 `Client({ clientId })` 로 local 디스코드 클라이언트에 IPC로 붙는다.
- 디스코드가 아직 안 켜졌을 수 있으니 `login()` 실패시 일정 간격으로 재시도(재연결).
- 활동 갱신은 **곡(또는 재생/정지)이 바뀔 때만** 호출한다. 매 폴링마다 보내지 말 것
  (디스코드 SET_ACTIVITY 속도제한 + 깜빡임 방지).
- 진행띠는 `startTimestamp`/`endTimestamp` 를 한번 넣으면 디스코드가 알아서 움직인다.

### ４.５ 앨범그림 처리
- `largeImageKey` 에 유튜브뮤직 앨범그림 **URL을 직접** 넣는다(외부 URL 허용됨).
- URL이 없을 때를 대비해 업로드해둔 자산키 `logo` 를 대체로 둔다.
- `smallImageKey` 는 URL이 안 되므로 업로드자산키 `logo` 로 둔다(작은 로고 표시용, 선택).

### ４.６ 상태변화 감지 / 일시정지 / 종료
- 곡서명 = `제목|가수` 로 만들어 직전과 비교, 다를 때만 갱신.
- 일시정지·곡없음·정보없음 → `clearActivity()`(초기판 기본동작).
- 창 닫기 → 트레이로 숨김. 트레이 《종료》 에서만 완전종료.

### ４.７ 설정(config) & 트레이
- `config.json`: `pollIntervalMs`(기본 `3000`).
- 트레이 메뉴: 《열기》, 《종료》.

## ５. 참고 코드 (뼈대)

> 아래는 출발점이다. 패키지의 실제 타입·이벤트이름이 다르면 그쪽에 맞춰 고쳐라.
> (예: `@xhayper/discord-rpc` 의 `SetActivity` 타입에 `type` 필드가 없으면 캐스팅하거나 빼라 — 어차피 best-effort.)

### src/main/constants.ts
```ts
export const YTM_URL = 'https://music.youtube.com';

// 디스코드 개발자포털에서 발급받아 채울 것 (8항 참고). 이것만 사람이 채운다.
export const DISCORD_CLIENT_ID = 'YOUR_DISCORD_CLIENT_ID';

export const POLL_INTERVAL_MS = 3000;
```

### src/main/reader.ts
```ts
import type { WebContents } from 'electron';

export interface NowPlaying {
  title: string;
  artist: string;
  album: string;
  cover: string | null;
  elapsed: number;
  duration: number;
  paused: boolean;
}

const READ_SCRIPT = `(() => {
  const m = navigator.mediaSession && navigator.mediaSession.metadata;
  const v = document.querySelector('video');
  if (!m || !v) return null;
  const art = (m.artwork && m.artwork.length)
    ? m.artwork[m.artwork.length - 1].src
    : null;
  return {
    title: m.title || '',
    artist: m.artist || '',
    album: m.album || '',
    cover: art,
    elapsed: v.currentTime || 0,
    duration: v.duration || 0,
    paused: v.paused
  };
})()`;

export async function readNowPlaying(wc: WebContents): Promise<NowPlaying | null> {
  try {
    return await wc.executeJavaScript(READ_SCRIPT, true);
  } catch {
    return null; // 페지 이동중 등
  }
}
```

### src/main/presence.ts
```ts
import { Client } from '@xhayper/discord-rpc';
import { DISCORD_CLIENT_ID } from './constants';
import type { NowPlaying } from './reader';

let client: Client | null = null;
let ready = false;
let lastTrack = '';

export async function initPresence(): Promise<void> {
  client = new Client({ clientId: DISCORD_CLIENT_ID });
  client.on('ready', () => { ready = true; });
  client.on('disconnected', () => { ready = false; scheduleReconnect(); });
  await connect();
}

async function connect(): Promise<void> {
  try {
    await client!.login();
  } catch {
    scheduleReconnect(); // 디스코드가 아직 안 켜졌을 수 있음
  }
}

function scheduleReconnect(): void {
  setTimeout(() => { if (!ready) connect(); }, 10_000);
}

export async function updatePresence(np: NowPlaying | null): Promise<void> {
  if (!client || !ready || !client.user) return;

  // 곡없음 / 일시정지 → 활동 지움
  if (!np || np.paused || !np.title) {
    if (lastTrack !== '') {
      lastTrack = '';
      await client.user.clearActivity().catch(() => {});
    }
    return;
  }

  const track = `${np.title}|${np.artist}`;
  if (track === lastTrack) return; // 바뀔 때만 갱신(속도제한 보호)
  lastTrack = track;

  const now = Date.now();
  await client.user.setActivity({
    type: 2, // Listening — 디스코드 판본에 따라 'Playing' 으로 보일 수 있음(정상)
    details: np.title.slice(0, 128),
    state: np.artist.slice(0, 128),
    largeImageKey: np.cover ?? 'logo', // URL 직접 가능; 없으면 업로드자산 'logo'
    largeImageText: (np.album || np.title).slice(0, 128),
    smallImageKey: 'logo',             // 소형이미지는 URL 불가 → 자산키
    startTimestamp: Math.floor(now - np.elapsed * 1000),
    endTimestamp: np.duration
      ? Math.floor(now + (np.duration - np.elapsed) * 1000)
      : undefined,
  }).catch(() => {});
}
```

### src/main/config.ts
```ts
import { app } from 'electron';
import { join } from 'node:path';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

export interface Config { pollIntervalMs: number; }
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
```

### src/main/index.ts
```ts
import { app, BrowserWindow, Tray, Menu, nativeImage } from 'electron';
import { join } from 'node:path';
import { YTM_URL } from './constants';
import { readNowPlaying } from './reader';
import { initPresence, updatePresence } from './presence';
import { loadConfig } from './config';

let win: BrowserWindow | null = null;
let tray: Tray | null = null;
let timer: NodeJS.Timeout | null = null;
let quitting = false;

function buildUserAgent(): string {
  // Electron/앱 토큰 제거 → Chrome 처럼 보이게(구글 로그인 차단 회피)
  return app.userAgentFallback
    .replace(/\sElectron\/[\d.]+/i, '')
    .replace(new RegExp(`\\s${app.getName()}\\/[\\d.]+`, 'i'), '')
    .trim();
}

function createWindow(): void {
  const ua = buildUserAgent();
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    title: '메아리',
    webPreferences: {
      partition: 'persist:main', // 로그인 유지
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.webContents.setUserAgent(ua);

  // 구글 OAuth 팝업 허용 + 같은 세션
  win.webContents.setWindowOpenHandler(() => ({
    action: 'allow',
    overrideBrowserWindowOptions: { webPreferences: { partition: 'persist:main' } },
  }));

  win.loadURL(YTM_URL, { userAgent: ua });

  win.on('close', (e) => {
    if (!quitting) { e.preventDefault(); win?.hide(); } // 닫기 → 트레이로
  });
}

function startPolling(): void {
  const { pollIntervalMs } = loadConfig();
  timer = setInterval(async () => {
    if (!win) return;
    const np = await readNowPlaying(win.webContents);
    await updatePresence(np);
  }, pollIntervalMs);
}

function createTray(): void {
  const img = nativeImage.createFromPath(join(process.resourcesPath, 'icon.png'));
  tray = new Tray(img.isEmpty() ? nativeImage.createEmpty() : img);
  tray.setToolTip('메아리');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '열기', click: () => win?.show() },
    { type: 'separator' },
    { label: '종료', click: () => { quitting = true; app.quit(); } },
  ]));
}

app.whenReady().then(async () => {
  createWindow();
  createTray();
  await initPresence();
  startPolling();
});

app.on('window-all-closed', () => { /* 트레이 상주 */ });
app.on('before-quit', () => { if (timer) clearInterval(timer); });
```

### src/preload/index.ts
```ts
// 핵심은 main 의 executeJavaScript 로 처리하므로 preload 는 비워둔다.
// (추후 설정창을 붙일 때 contextBridge 로 확장)
export {};
```

## ６. 빌드 & 포장

### package.json (뼈대)
```json
{
  "name": "maeari",
  "version": "1.0.0",
  "description": "Show the music you are listening to on Discord.",
  "license": "MIT",
  "author": "JULY",
  "main": "out/main/index.js",
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "dist:win": "electron-vite build && electron-builder --win",
    "dist:mac": "electron-vite build && electron-builder --mac"
  }
}
```
> 의존성은 `"latest"` 문자그대로 박지 말고, 아래 런북처럼 `npm install <패키지>@latest` 로 설치해
> package.json에 실제 판본범위가 적히게 하라.

### electron.vite.config.ts
```ts
import { defineConfig } from 'electron-vite';
import { resolve } from 'node:path';

export default defineConfig({
  main:    { build: { lib: { entry: resolve(__dirname, 'src/main/index.ts') } } },
  preload: { build: { lib: { entry: resolve(__dirname, 'src/preload/index.ts') } } },
  // renderer 없음: music.youtube.com 을 직접 적재.
  // electron-vite 가 renderer 없음으로 오류내면 빈 renderer 항목을 최소로 추가.
});
```

### electron-builder.yml
```yaml
appId: dev.july.maeari
productName: Maeari
directories:
  output: dist
  buildResources: build
files:
  - out/**/*
  - package.json
extraResources:
  - from: resources
    to: .
win:
  target: [nsis, portable]
mac:
  target: [dmg]
  category: public.app-category.music
  identity: null   # 코드서명 안함(경고는 README 안내)
```
> 빌드물은 각 OS에서 그 OS용으로 뽑는다(윈도우는 윈도우, 맥 M４는 맥). 서명은 생략한다.

### .gitignore
```
node_modules/
out/
dist/
*.log
.DS_Store
```

## ７. 깃헙 공개 (MIT) — 해야 할 것

１. **LICENSE**: 표준 MIT 전문을 만들고 저작권줄을 `Copyright (c) 2026 JULY` 로 한다.
２. **README.md**: 아래 절을 넣는다 —
   - 프로젝트 소개(무엇을 하는가)
   - 받기/빌드 방법(런북 발췌)
   - 설정(`config.json`) 설명
   - **포크하는 사람을 위한 《자기 디스코드 앱 만들기》 안내**(８항)
   - 알려진 문제(로그인 UA, 미서명 경고, Listening↔Playing)
   - **비제휴 고지(아래 문구를 그대로 넣을 것)**
３. **비제휴 고지 문구(README 하단에 그대로)**:
   > 본 프로그람은 구글(Google LLC) 및 유튜브와 아무런 제휴·승인·후원 관계가 없는 독립적인 비공식 도구입니다.
   > 《YouTube》, 《YouTube Music》 및 관련 명칭·로고·상표는 각 소유자의 자산이며, 본 프로젝트에서의 언급은 식별·참고 목적일 뿐입니다.
   > 본 프로그람은 《있는 그대로(AS IS)》 제공되며, 사용에 따르는 모든 책임은 사용자에게 있습니다.
   >
   > This project is not affiliated with, endorsed by, or sponsored by Google LLC or YouTube.
   > "YouTube", "YouTube Music", and related names, logos, and trademarks are the property of their respective owners; any reference is for identification purposes only.
   > This software is provided "AS IS", and you use it at your own risk.
４. 소스 위주로 공개한다. 빌드물(설치파일)을 Releases에 올릴거면 위 고지·중립이름을 더 확실히 한다.

## ８. 디스코드 응용프로그람 만들기 (Client ID & 자산)

1. `discord.com/developers/applications` → **New Application** → 이름을 짓는다(이 이름이 활동의 앱이름으로 표시됨, 예: `Maeari`).
2. **Application ID** 를 복사 → `src/main/constants.ts` 의 `DISCORD_CLIENT_ID` 에 채운다.
3. 왼쪽 **Rich Presence → Art Assets** → 이미지를 하나 올리고 이름을 `logo` 로 한다. 크기는 `1024×1024` 권장(최소 `512×512`). 자산키는 소문자로 저장된다.
4. 봇/토큰은 만들 필요 없다(IPC RPC는 Client ID만 쓴다).
5. 디스코드 데스크탑 클라이언트를 켜두고, 사용자설정 → 활동 개인정보에서 《현재 활동을 상태 메세지로 표시》를 켠다.

## ９. 알려진 함정 & 대응

- **구글 로그인 차단**: UA에서 `Electron` 토큰 제거가 1차. 그래도 막히면 최신 Chrome 데스크탑 UA 전체를 박는다. `persist:main` 파티션으로 한번 로그인하면 유지된다.
- **Listening 이 Playing 으로 보임**: IPC RPC에서 흔한 일. 정상으로 취급하고 억지로 고치려 시간쓰지 말 것.
- **미서명 경고**: 윈도우 SmartScreen 경고, 맥 《손상되여 열 수 없음》 → 맥은 `xattr -cr "/Applications/Maeari.app"` 안내를 README에 넣는다.
- **속도제한**: 활동은 곡 바뀔 때만 갱신(매 폴링 금지).
- **앨범그림 URL**: 공개 https 라야 한다. 유튜브뮤직의 `googleusercontent` 류 URL은 공개라 그대로 된다.

## １０. 절대 하지 말 것

- 이름·로고에 《YouTube》/《YouTube Music》 또는 구글 상표를 쓰지 말 것(상표문제).
- 디스코드 **사용자 토큰**을 받거나 쓰지 말 것 → ToS 위반. IPC RPC + Client ID 만 쓴다.
- Pear Desktop을 fork하거나 유튜브뮤직의 코드·자산을 묶어서 배포하지 말 것.
- 렌더러에서 localStorage/sessionStorage 쓰지 말 것.
- `node_modules`, `dist`, `out` 을 깃에 올리지 말 것.

## １１. 완료 기준 (체크리스트)

- [ ] `npm run dev` 로 창이 뜨고 유튜브뮤직이 적재되며 로그인이 된다.
- [ ] 곡을 틀면 디스코드 프로필에 제목·가수·앨범그림·진행띠가 뜬다.
- [ ] 곡을 넘기면 표시가 바뀌고, 일시정지하면 활동이 사라진다.
- [ ] 디스코드를 나중에 켜도 자동으로 다시 붙는다.
- [ ] 창을 닫아도 트레이에 남고, 트레이 《종료》로 완전히 꺼진다.
- [ ] `npm run dist:win` / `dist:mac` 로 빌드물이 나온다.
- [ ] LICENSE(MIT) + README(비제휴 고지 포함) + .gitignore 가 있다.

## １２. 실행 순서 (런북)

```bash
# 1) 골격 + 의존성
npm init -y
npm install -D electron@latest electron-vite@latest electron-builder@latest typescript@latest @types/node@latest
npm install @xhayper/discord-rpc@latest

# 2) 위 구조대로 파일 작성 + constants.ts 의 DISCORD_CLIENT_ID 채우기

# 3) 개발 실행
npm run dev

# 4) 빌드물 (각 OS에서)
npm run dist:win   # 윈도우에서
npm run dist:mac   # 맥(M4)에서

# 5) 깃헙 공개 (MIT)
git init
git add .
git commit -m "first commit"
gh repo create maeari --public --source=. --push   # gh CLI 있을 때
# 첫 배포 태그
git tag v1.0.0
git push --tags
```
