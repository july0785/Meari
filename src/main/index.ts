import { app, BrowserWindow, WebContentsView, Tray, Menu, nativeImage, session, ipcMain, shell } from 'electron';
import { join } from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import { YTM_URL, DISCORD_CLIENT_ID } from './constants';
import { readNowPlaying } from './reader';
import { initPresence, updatePresence } from './presence';
import { loadConfig } from './config';

// 윈도우의 "가려진 창 감지"가 숨긴 창의 렌더링을 얼려 버리고, 트레이에서 복원할 때
// 깨어나지 못해 검은 화면·연속 다시그리기가 생긴다 → 감지 자체를 끈다. (알려진 Electron 버그의 정석 대응)
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');

// GPU 가속은 기본 사용 — 끄면 영상 디코딩·합성을 전부 CPU 가 떠안아 사용량이 치솟는다.
// 화면이 깜빡이는 환경에서만 config.json 에 "disableGpu": true 를 넣어 소프트웨어 합성으로 전환.
if (loadConfig().disableGpu) app.disableHardwareAcceleration();

// 중복 실행 방지: 두 번째 인스턴스는 종료하고 기존 창을 앞으로 가져온다
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  });
}

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

  // 웹페이지의 권한 요청(위치·알림·마이크 등)은 기본 거부.
  // 전체화면과 DRM(mediaKeySystem)만 재생에 필요할 수 있어 허용한다.
  ses.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === 'fullscreen' || permission === 'mediaKeySystem');
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
// 앱 안에서 열어도 되는 신뢰 도메인(유튜브·구글 로그인 계열)인지.
// 그 외 링크는 앱(로그인 세션을 가진) 안이 아니라 기본 브라우저로 연다.
function isTrustedDomain(url: string): boolean {
  return (
    hostEndsWith(url, 'youtube.com') ||
    hostEndsWith(url, 'youtube-nocookie.com') ||
    hostEndsWith(url, 'google.com') ||
    hostEndsWith(url, 'google.co.kr') ||
    hostEndsWith(url, 'googleusercontent.com') ||
    hostEndsWith(url, 'gstatic.com')
  );
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
      // backgroundThrottling 은 기본값(true) 사용: 숨겨진 동안 타이머만 느려질 뿐
      // 음악 재생은 영향받지 않고, CPU 를 아낀다.
    },
  });
  view.setBackgroundColor('#0f0f0f'); // 불투명 배경 — 투명이면 페인트 누적으로 깜빡임(electron#42335)
  win.contentView.addChildView(view);
  updateViewBounds();

  const wc = view.webContents;
  wc.setUserAgent(CHROME_UA);

  // 팝업: 신뢰 도메인(구글 OAuth 등)만 앱 안에서 허용, 그 외는 기본 브라우저로
  wc.setWindowOpenHandler(({ url }) => {
    if (isTrustedDomain(url)) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: { webPreferences: { partition: 'persist:main' } },
      };
    }
    shell.openExternal(url).catch(() => {});
    return { action: 'deny' };
  });

  // 본 뷰의 페이지 이동도 신뢰 도메인으로 제한 — 외부 사이트는 기본 브라우저로
  wc.on('will-navigate', (e, url) => {
    if (!isTrustedDomain(url)) {
      e.preventDefault();
      shell.openExternal(url).catch(() => {});
    }
  });

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

  // 트레이 복원 시 검은 화면 방지: 숨길 때 뷰 표시를 꺼서 합성기를 정리하고,
  // 다시 보일 때 켜서 새로 합성하게 한다. (재생 중인 음악은 끊기지 않는다)
  const wakeView = () => {
    if (!view) return;
    view.setVisible(true);
    updateViewBounds();
    setTimeout(() => view?.webContents.invalidate(), 60);
  };
  win.on('show', wakeView);
  win.on('restore', wakeView);
  win.on('hide', () => view?.setVisible(false));
  win.on('minimize', () => view?.setVisible(false));

  win.on('maximize', () => win?.webContents.send('meari:maximized', true));
  win.on('unmaximize', () => win?.webContents.send('meari:maximized', false));

  win.on('close', (e) => {
    if (!quitting) { e.preventDefault(); win?.hide(); } // 닫기 → 트레이로 (hide 이벤트가 뷰를 정리)
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
  const showWindow = () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  };
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '열기', click: showWindow },
    { type: 'separator' },
    { label: '종료', click: () => { quitting = true; app.quit(); } },
  ]));
  tray.on('double-click', showWindow);
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
