import { app, BrowserWindow, Tray, Menu, nativeImage, session } from 'electron';
import { join } from 'node:path';
import { YTM_URL, DISCORD_CLIENT_ID } from './constants';
import { readNowPlaying } from './reader';
import { initPresence, updatePresence } from './presence';
import { loadConfig } from './config';

// Client ID 우선순위: 환경변수 > config.json > constants.ts 기본값
function resolveClientId(): string {
  return process.env.DISCORD_CLIENT_ID
    || loadConfig().discordClientId
    || DISCORD_CLIENT_ID;
}

let win: BrowserWindow | null = null;
let tray: Tray | null = null;
let timer: NodeJS.Timeout | null = null;
let quitting = false;

// 유튜브뮤직에는 일렉트론 흔적이 없는 완전한 크롬 데스크톱 UA로 위장한다.
// 버전은 일렉트론에 내장된 실제 크로미엄 버전을 그대로 써서 모순이 없게 한다.
function buildUserAgent(): string {
  const platform =
    process.platform === 'darwin' ? 'Macintosh; Intel Mac OS X 10_15_7'
    : process.platform === 'linux' ? 'X11; Linux x86_64'
    : 'Windows NT 10.0; Win64; x64';
  const chrome = process.versions.chrome ?? '140.0.0.0';
  return `Mozilla/5.0 (${platform}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chrome} Safari/537.36`;
}

const CHROME_UA = buildUserAgent();

// 구글 로그인의 "브라우저 또는 앱이 안전하지 않을 수 있습니다" 차단 회피.
// 일반 페이지(유튜브뮤직)에는 크롬 UA로 위장하되, 구글 로그인 페이지(accounts.google.com)에는
// 진짜 UA를 그대로 보낸다. 로그인 페이지에까지 위조 UA를 보내면 불일치로 차단되기 때문이다.
// (검증된 방식: th-ch/youtube-music)
function applyChromeIdentity(): void {
  const realUserAgent = app.userAgentFallback; // 덮어쓰기 전에 진짜 UA 캡처
  app.userAgentFallback = CHROME_UA;

  const ses = session.fromPartition('persist:main');
  ses.setUserAgent(CHROME_UA);
  ses.webRequest.onBeforeSendHeaders((details, callback) => {
    if (details.url.startsWith('https://accounts.google.com')) {
      details.requestHeaders['User-Agent'] = realUserAgent;
    }
    callback({ requestHeaders: details.requestHeaders });
  });
}

function createWindow(): void {
  const ua = CHROME_UA;
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
  applyChromeIdentity(); // 창 생성 전에 크롬 위장 적용
  createWindow();
  createTray();
  await initPresence(resolveClientId());
  startPolling();
});

app.on('window-all-closed', () => { /* 트레이 상주 */ });
app.on('before-quit', () => { if (timer) clearInterval(timer); });
