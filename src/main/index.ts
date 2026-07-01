import { app, BrowserWindow, WebContentsView, Tray, Menu, nativeImage, session, ipcMain } from 'electron';
import { join } from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import { YTM_URL, DISCORD_CLIENT_ID } from './constants';
import { readNowPlaying } from './reader';
import { initPresence, updatePresence } from './presence';
import { loadConfig } from './config';

// 일부 GPU(특히 AMD)에서 WebContentsView 합성이 깜빡이거나 안 그려지는 문제 회피.
// 소프트웨어 합성으로 전환 — 음악 앱이라 성능 영향은 미미하다. (app.ready 전에 호출)
app.disableHardwareAcceleration();

const TITLEBAR_H = 44; // 제목표시줄 높이(px). 렌더러 CSS 의 --bar-h 와 일치해야 함.

let win: BrowserWindow | null = null;
let view: WebContentsView | null = null;
let tray: Tray | null = null;
let timer: NodeJS.Timeout | null = null;
let quitting = false;

// Client ID 우선순위: 환경변수 > config.json > constants.ts 기본값
function resolveClientId(): string {
  return process.env.DISCORD_CLIENT_ID
    || loadConfig().discordClientId
    || DISCORD_CLIENT_ID;
}

// ---- User-Agent (구글 로그인 차단 회피) ----

// 유튜브뮤직에는 일렉트론 흔적이 없는 완전한 크롬 데스크톱 UA로 위장한다.
function buildUserAgent(): string {
  const platform =
    process.platform === 'darwin' ? 'Macintosh; Intel Mac OS X 10_15_7'
    : process.platform === 'linux' ? 'X11; Linux x86_64'
    : 'Windows NT 10.0; Win64; x64';
  const chrome = process.versions.chrome ?? '140.0.0.0';
  return `Mozilla/5.0 (${platform}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chrome} Safari/537.36`;
}

const CHROME_UA = buildUserAgent();

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

// ---- URL 도우미 ----
function hostEndsWith(url: string, suffix: string): boolean {
  try { return new URL(url).hostname.endsWith(suffix); } catch { return false; }
}
// 일반 유튜브(유튜브뮤직 제외)인지
function isPlainYouTube(url: string): boolean {
  try {
    const h = new URL(url).hostname;
    return h === 'www.youtube.com' || h === 'youtube.com';
  } catch { return false; }
}

// ---- 제목표시줄용 로고(투명 흰 워드마크)를 data URL 로 읽는다 ----
function logoDataUrl(): string {
  const candidates = [
    join(process.resourcesPath, 'logo-titlebar.png'),          // 여백 잘라낸 제목표시줄용(패키지본)
    join(app.getAppPath(), 'resources', 'logo-titlebar.png'),  // 개발
    join(__dirname, '../../resources/logo-titlebar.png'),
    join(process.resourcesPath, 'discord-logo.png'),           // 대체
  ];
  for (const p of candidates) {
    try {
      if (existsSync(p)) return `data:image/png;base64,${readFileSync(p).toString('base64')}`;
    } catch { /* 다음 후보 */ }
  }
  return '';
}

function updateViewBounds(): void {
  if (!win || !view) return;
  const [w, h] = win.getContentSize();
  view.setBounds({ x: 0, y: TITLEBAR_H, width: w, height: Math.max(0, h - TITLEBAR_H) });
}

// WebContentsView 가 첫 페인트를 건너뛰는 증상(electron#42335) 대비:
// 바운즈를 1px 흔들었다 되돌리고 강제 리페인트해 그리기를 깨운다.
function repaintView(): void {
  if (!win || !view) return;
  const [w, h] = win.getContentSize();
  view.setBounds({ x: 0, y: TITLEBAR_H, width: w, height: Math.max(0, h - TITLEBAR_H - 1) });
  setTimeout(() => {
    if (!win || !view) return;
    updateViewBounds();
    view.webContents.invalidate();
  }, 50);
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: '메아리',
    frame: false,             // 프레임 제거 → 커스텀 제목표시줄
    backgroundColor: '#030303',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // 제목표시줄(렌더러) 적재: 개발 서버 or 빌드 파일
  const rendererUrl = process.env['ELECTRON_RENDERER_URL'];
  if (rendererUrl) win.loadURL(rendererUrl);
  else win.loadFile(join(__dirname, '../renderer/index.html'));

  // 유튜브뮤직을 담는 뷰(제목표시줄 아래)
  view = new WebContentsView({
    webPreferences: {
      partition: 'persist:main', // 로그인 유지
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false, // 트레이로 숨겨도 렌더/재생 유지
    },
  });
  view.setBackgroundColor('#0f0f0f'); // 불투명 배경 — 투명이면 페인트 누적으로 깜빡임(electron#42335)
  win.contentView.addChildView(view);
  updateViewBounds();

  const wc = view.webContents;
  wc.setUserAgent(CHROME_UA);

  // 구글 OAuth 팝업 허용 + 같은 세션
  wc.setWindowOpenHandler(() => ({
    action: 'allow',
    overrideBrowserWindowOptions: { webPreferences: { partition: 'persist:main' } },
  }));

  // 로그인이 팝업으로 뜬 경우: 인증이 끝나 유튜브로 넘어가면 팝업을 닫고 뷰를 새로고침해 로그인 반영
  wc.on('did-create-window', (child) => {
    child.webContents.on('did-navigate', (_e, url) => {
      if (hostEndsWith(url, 'youtube.com')) {
        child.close();
        wc.loadURL(YTM_URL);
      }
    });
  });

  // 로그인 후 일반 유튜브로 빠지면 유튜브뮤직으로 되돌린다 (구글 로그인 페이지는 건드리지 않음)
  wc.on('did-navigate', (_e, url) => {
    if (isPlainYouTube(url)) wc.loadURL(YTM_URL);
  });

  // 첫 페인트 누락 대비: 로드/표시 시점마다 리페인트를 깨운다
  wc.on('did-finish-load', repaintView);
  wc.on('did-stop-loading', repaintView);

  wc.loadURL(YTM_URL, { userAgent: CHROME_UA });

  win.on('resize', updateViewBounds);
  // 트레이로 숨겼다 다시 열 때 뷰가 안 그려지는 문제: 자식 뷰를 재부착해 강제 재composite
  win.on('show', () => {
    if (!win || !view) return;
    win.contentView.removeChildView(view);
    win.contentView.addChildView(view);
    updateViewBounds();
    setTimeout(() => view?.webContents.invalidate(), 60);
  });
  win.on('maximize', () => win?.webContents.send('meari:maximized', true));
  win.on('unmaximize', () => win?.webContents.send('meari:maximized', false));

  win.on('close', (e) => {
    if (!quitting) { e.preventDefault(); win?.hide(); } // 닫기 → 트레이로
  });
}

function startPolling(): void {
  const { pollIntervalMs } = loadConfig();
  timer = setInterval(async () => {
    if (!view) return;
    const np = await readNowPlaying(view.webContents);
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
  tray.on('double-click', () => win?.show());
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null); // 기본 메뉴바(File Edit View Window) 제거
  applyChromeIdentity();

  // 제목표시줄 IPC
  ipcMain.handle('meari:logo', () => logoDataUrl());
  ipcMain.on('meari:win', (_e, action) => {
    if (!win) return;
    if (action === 'minimize') win.minimize();
    else if (action === 'maximize') win.isMaximized() ? win.unmaximize() : win.maximize();
    else if (action === 'close') win.hide(); // 닫기 → 트레이로 상주
  });

  createWindow();
  createTray();
  await initPresence(resolveClientId());
  startPolling();
});

app.on('window-all-closed', () => { /* 트레이 상주 */ });
app.on('before-quit', () => { if (timer) clearInterval(timer); });
