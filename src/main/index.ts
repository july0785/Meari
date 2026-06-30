import { app, BrowserWindow, Tray, Menu, nativeImage } from 'electron';
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
  await initPresence(resolveClientId());
  startPolling();
});

app.on('window-all-closed', () => { /* 트레이 상주 */ });
app.on('before-quit', () => { if (timer) clearInterval(timer); });
