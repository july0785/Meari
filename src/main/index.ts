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

// 일렉트론에 내장된 실제 크로미엄 메이저 버전 (예: '140')
const CHROME_MAJOR = process.versions.chrome?.split('.')[0] ?? '140';

// 일반 크롬 데스크톱과 동일한 User-Agent 문자열을 만든다.
function buildUserAgent(): string {
  const platform =
    process.platform === 'darwin' ? 'Macintosh; Intel Mac OS X 10_15_7'
    : process.platform === 'linux' ? 'X11; Linux x86_64'
    : 'Windows NT 10.0; Win64; x64';
  return `Mozilla/5.0 (${platform}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROME_MAJOR}.0.0.0 Safari/537.36`;
}

// 구글 로그인의 "브라우저 또는 앱이 안전하지 않을 수 있습니다" 차단 회피.
// UA 문자열만 바꿔서는 부족하고, 클라이언트 힌트(Sec-CH-UA)에도 "Google Chrome" 브랜드를
// 넣어 줘야 일렉트론이 아니라 일반 크롬으로 인식된다. (메인 창과 OAuth 팝업이 같은 파티션을 쓰므로 둘 다 적용됨)
function applyChromeIdentity(): void {
  const ua = buildUserAgent();
  app.userAgentFallback = ua;

  const ses = session.fromPartition('persist:main');
  ses.setUserAgent(ua);
  ses.webRequest.onBeforeSendHeaders((details, callback) => {
    const headers = details.requestHeaders;
    headers['sec-ch-ua'] =
      `"Chromium";v="${CHROME_MAJOR}", "Google Chrome";v="${CHROME_MAJOR}", "Not?A_Brand";v="99"`;
    headers['sec-ch-ua-mobile'] = '?0';
    headers['sec-ch-ua-platform'] =
      process.platform === 'darwin' ? '"macOS"' : process.platform === 'linux' ? '"Linux"' : '"Windows"';
    callback({ requestHeaders: headers });
  });
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
  applyChromeIdentity(); // 창 생성 전에 크롬 위장 적용
  createWindow();
  createTray();
  await initPresence(resolveClientId());
  startPolling();
});

app.on('window-all-closed', () => { /* 트레이 상주 */ });
app.on('before-quit', () => { if (timer) clearInterval(timer); });
