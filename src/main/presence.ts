import { Client } from '@xhayper/discord-rpc';
import { loadConfig } from './config';
import type { NowPlaying } from './reader';

let client: Client | null = null;
let ready = false;
let lastTrack = '';
let lastStart = 0;    // 마지막으로 보낸 startTimestamp(ms). 재생위치 어긋남 감지용.
let lastPaused = false;
let lastElapsed = 0;  // 마지막 전송 시점의 재생위치(초). 일시정지 중 탐색 감지용.
let lastRepeat = '';  // 마지막 전송 시점의 반복 모드. 뱃지 갱신 감지용.

// 저장소에 올려 둔 상태 뱃지 아이콘 (공개 https 라 디스코드가 그대로 가져간다)
const ICON_BASE = 'https://raw.githubusercontent.com/july0785/Meari/main/resources';
const COVER_FALLBACK = `${ICON_BASE}/icon.png`;       // 앨범 이미지가 없을 때
// ?v= 는 디스코드 이미지 캐시 우회용 — 아이콘을 갈아끼우면 숫자를 올릴 것
const BADGE_PAUSE = `${ICON_BASE}/badge-pause.png?v=3`;
const BADGE_REPEAT = `${ICON_BASE}/badge-repeat.png?v=3`;
const BADGE_REPEAT_ONE = `${ICON_BASE}/badge-repeat-one.png?v=3`;
let rawTitleMode = false; // config.rawTitle: 제목 정리 끄기
let videoCoverMode: 'scenery' | 'crop' = 'scenery'; // config.videoCover: 영상 썸네일 처리 방식

export async function initPresence(clientId: string): Promise<void> {
  const cfg = loadConfig();
  rawTitleMode = Boolean(cfg.rawTitle);
  videoCoverMode = cfg.videoCover === 'crop' ? 'crop' : 'scenery';
  client = new Client({ clientId });
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

// 유튜브 제목에서 거추장스러운 부분을 덜어 진짜 제목만 남긴다(최선의 추정).
// 핵심 원칙: 무엇을 지울지 확신이 없으면 남긴다. 구분자로 나눈 조각은
// "가수명과 겹칠 때만" 지워서, 곡명이 잘려 나가는 사고를 막는다.
function cleanTitle(raw: string, artist: string): string {
  const original = (raw || '').trim();
  if (rawTitleMode) return original; // 정리 끔 — 원제목 그대로
  let t = original;

  // [태그]·【태그】 제거 (앞쪽 연속 태그 + 어디에 있든 【COVER】【MV】 류)
  t = t.replace(/^(\s*[[【][^\]】]*[\]】]\s*)+/, '');
  t = t.replace(/【[^】]*】/g, ' ');

  // (Official Video) (MV) (가사) 류 잡음 괄호 제거
  t = t.replace(
    /\s*[([]\s*(official[^)\]]*|m\/?v|mv|audio|lyrics?(\s*video)?|visualizer|가사|뮤직비디오|커버|cover|hd|4k|8k)\s*[)\]]/gi,
    ' ',
  );

  // 외국어 병기 괄호 제거: 본문 문자와 "다른" 문자만 담긴 괄호는 병기로 간주.
  // 한글 본문 → 한글 없는 괄호 제거 (예: 초계반(アスノヨゾラ哨戒班), 아카네 리제(Akane Lize))
  // 일본어 본문 → CJK 없는(라틴) 괄호 제거 (예: 瞬間、シンフォニー。(A Symphony of Moments))
  const JP = /[぀-ヿ一-鿿]/; // 가나 + 한자
  const outside = t.replace(/[(（][^)）]*[)）]/g, '');
  if (/[가-힣]/.test(outside)) {
    t = t.replace(/\s*[(（]([^)）]*)[)）]/g, (m, inner) => (/[가-힣]/.test(inner) ? m : ' '));
  } else if (JP.test(outside)) {
    t = t.replace(/\s*[(（]([^)）]*)[)）]/g, (m, inner) => (/[가-힣]/.test(inner) || JP.test(inner) ? m : ' '));
  }

  // 구분자로 나눠 불필요한 조각 제거 (확신 있는 것만):
  // ① 가수명과 겹치는 조각, ② 한글 조각이 있을 때 한글이 전혀 없는 조각(영문 번역 꼬리)
  const norm = (s: string): string => s.toLowerCase().replace(/\s+/g, '');
  const a = norm(artist || '');
  const parts = t.split(/\s*[|｜❘丨]\s*|\s+[-–—]\s+/).map((s) => s.trim()).filter(Boolean);
  if (parts.length > 1) {
    let kept = parts;
    if (a.length >= 2) {
      const noArtist = kept.filter((p) => {
        const np = norm(p);
        // 조각 ⊆ 가수명은 안전. 가수명 ⊆ 조각은 짧은 가수명(IU 등)이 제목에
        // 우연히 들어가는 오인이 있어 가수명이 5자 이상일 때만 적용.
        return !(np.length >= 2 && (a.includes(np) || (a.length >= 5 && np.includes(a))));
      });
      if (noArtist.length > 0) kept = noArtist;
    }
    // 원문(한글/일본어) 조각이 있으면, 그 문자가 전혀 없는 조각(영문 번역 꼬리)은 버린다
    if (kept.length > 1) {
      if (kept.some((p) => /[가-힣]/.test(p))) {
        const orig = kept.filter((p) => /[가-힣]/.test(p));
        if (orig.length > 0) kept = orig;
      } else if (kept.some((p) => JP.test(p))) {
        const orig = kept.filter((p) => JP.test(p));
        if (orig.length > 0) kept = orig;
      }
    }
    if (kept.length > 0 && kept.length < parts.length) t = kept.join(' - ');
  }

  t = t.replace(/\s{2,}/g, ' ').trim();
  return t || original;
}

// 디스코드 largeImageKey 는 최대 256자. 넘으면 setActivity 전체가 실패하므로 반드시 지킨다.
const MAX_IMAGE_URL = 256;

// 곡별로 고정된 실사 풍경 사진 (Lorem Picsum, 시드 기반이라 같은 곡 = 항상 같은 사진).
// picsum 은 302 리다이렉트를 주므로 weserv 로 감싸 직접 200 응답으로 만든다(디스코드 프록시 안전).
function sceneryUrl(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  const key = Math.abs(h).toString(36);
  return `https://images.weserv.nl/?url=${encodeURIComponent(`picsum.photos/seed/meari-${key}/600/600`)}`;
}

// 영상(16:9) 썸네일은 정사각으로 만들기 애매하다: 크롭은 내용이 잘리고, 레터박스는 휑하다.
// 기본은 곡별 고정 풍경 이미지로 대체하고, config.videoCover='crop' 이면 스마트 크롭
// (a=attention: 시각적으로 중요한 영역 중심)으로 자른다.
// 크롭 시 썸네일 URL 의 긴 쿼리(?sqp=...)는 버리고 영상 ID 기반의 짧은 표준 URL 로 재구성
// (안 그러면 인코딩 후 256자를 넘겨 활동 갱신이 통째로 실패한다).
// 이미 정사각인 앨범 아트(googleusercontent 등)는 그대로 둔다.
function coverImage(cover: string | null, seed: string): string | null {
  if (!cover) return null;
  if (/ytimg\.com|\/vi\//.test(cover)) {
    if (videoCoverMode === 'scenery') return sceneryUrl(seed);
    const m = cover.match(/\/vi\/([^/?#]+)\//);
    if (!m) return null; // 영상 ID를 못 찾으면 로고로 대체
    // hqdefault 는 4:3 이라 검은 띠가 이미지에 구워져 있음 → 진짜 16:9 인
    // maxresdefault 를 쓰고, 없는 영상은 mqdefault(항상 존재)로 자동 대체
    const primary = encodeURIComponent(`i.ytimg.com/vi/${m[1]}/maxresdefault.jpg`);
    const fallback = encodeURIComponent(`i.ytimg.com/vi/${m[1]}/mqdefault.jpg`);
    const url = `https://images.weserv.nl/?url=${primary}&default=${fallback}&w=600&h=600&fit=cover&a=attention`;
    return url.length <= MAX_IMAGE_URL ? url : null;
  }
  return cover.length <= MAX_IMAGE_URL ? cover : null;
}

export async function updatePresence(np: NowPlaying | null): Promise<void> {
  if (!client || !ready || !client.user) return;

  // 곡 정보 자체가 없을 때만 활동 제거 (일시정지는 유지 — 곡을 계속 보여 준다)
  if (!np || !np.title) {
    if (lastTrack !== '') {
      lastTrack = '';
      lastStart = 0;
      lastPaused = false;
      lastElapsed = 0;
      lastRepeat = '';
      await client.user.clearActivity().catch(() => {});
    }
    return;
  }

  const now = Date.now();
  const track = `${np.title}|${np.artist}`;
  const hasDuration = Number.isFinite(np.duration) && np.duration > 0;
  const start = Math.floor(now - np.elapsed * 1000);

  // 갱신 조건: 곡이 바뀌었거나, 재생/정지 상태가 바뀌었거나, 재생위치가 5초 이상 어긋났을 때.
  // 어긋남 감지는 ① 곡 전환 직후 stale 한 위치 보정, ② 사용자 탐색(seek) 반영에 쓰인다.
  // 정상 재생 중에는 start 가 거의 일정해 갱신이 안 나가므로 속도제한이 보호된다.
  const trackChanged = track !== lastTrack;
  const pausedChanged = np.paused !== lastPaused;
  const drifted = !np.paused && Math.abs(start - lastStart) > 5000;
  // 일시정지 중 탐색(위치 이동)하면 표시 중인 멈춘 위치 글자를 갱신
  const pausedSeeked = np.paused && Math.abs(np.elapsed - lastElapsed) > 3;
  const repeatChanged = np.repeat !== lastRepeat;
  if (!trackChanged && !pausedChanged && !drifted && !pausedSeeked && !repeatChanged) return;

  lastTrack = track;
  lastPaused = np.paused;
  lastElapsed = np.elapsed;
  lastRepeat = np.repeat;
  if (!np.paused) lastStart = start;

  // 디스코드는 details/state 가 2자 미만이면 거부한다 → 짧으면 여백으로 채움
  const pad2 = (s: string): string => (s.length < 2 ? (s + '  ').slice(0, 2) : s);
  const title = pad2(cleanTitle(np.title, np.artist).slice(0, 128));
  const artist = pad2((np.artist || 'YouTube Music').slice(0, 128));

  // 일시정지: 디스코드 진행바는 멈출 수 없다(항상 클라이언트 시계로 굴러가고,
  // "정지" 신호 자체가 API 에 없음 — 스포티파이도 일시정지하면 활동이 사라짐).
  // 그래서 바 대신 멈춘 위치를 글자로 고정 표시한다. 예: 가수 · ⏸ 1:23 / 4:20
  const fmtTime = (sec: number): string => {
    const s = Math.max(0, Math.floor(sec));
    const h = Math.floor(s / 3600);
    const m = Math.floor(s / 60) % 60;
    const ss = String(s % 60).padStart(2, '0');
    return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
  };
  const state = np.paused
    ? (hasDuration
        ? `${artist} · ⏸ ${fmtTime(np.elapsed)} / ${fmtTime(np.duration)}`
        : `${artist} · ⏸ 일시정지`
      ).slice(0, 128)
    : artist;

  // 상태 뱃지(앨범아트 구석의 작은 원형 아이콘): 일시정지 > 한 곡 반복 > 반복
  const badge = np.paused
    ? { key: BADGE_PAUSE, text: '일시정지' }
    : np.repeat === 'ONE'
      ? { key: BADGE_REPEAT_ONE, text: '한 곡 반복 중' }
      : np.repeat === 'ALL'
        ? { key: BADGE_REPEAT, text: '반복 중' }
        : null;

  // 라이브러리의 setActivity 는 신형 필드(status_display_type)를 걸러내므로
  // 원시 SET_ACTIVITY 요청을 직접 보낸다.
  const assets: Record<string, string> = {
    large_image: coverImage(np.cover, track) ?? COVER_FALLBACK, // 정사각 보정 URL; 없으면 앱 로고
  };
  // 앨범명이 있을 때만 표시 — 없으면 칸 자체를 비운다 (제목으로 돌려막지 않음)
  if (np.album) assets.large_text = pad2(np.album.slice(0, 128));
  if (badge) { assets.small_image = badge.key; assets.small_text = badge.text; }

  const activity: Record<string, unknown> = {
    // 항상 Listening("듣는 중") 유지. 일시정지 때 일반 활동으로 바꾸면 ♫ 0:00 줄은
    // 사라지지만 헤더가 "하는 중"으로 바뀌어 더 어색하다(사용자 결정: 듣는 중 고정).
    type: 2,
    details: title,
    state,
    // 상태줄(멤버 목록 등)에 앱 이름 대신 details(곡 제목)를 표시 (0=앱이름, 1=state, 2=details)
    status_display_type: 2,
    assets,
  };
  // 진행 바(타임스탬프)는 재생 중일 때만. 일시정지 중엔 위의 state 글자가 위치를 보여 준다.
  if (!np.paused) {
    activity.timestamps = hasDuration
      ? { start, end: Math.floor(now + (np.duration - np.elapsed) * 1000) }
      : { start };
  }

  const send = (a: Record<string, unknown>) =>
    client!.request('SET_ACTIVITY', { pid: process.pid, activity: a });

  try {
    await send(activity);
  } catch {
    // 커버 URL 문제일 수 있으니 앱 로고로 1회 재시도
    try {
      await send({ ...activity, assets: { ...assets, large_image: COVER_FALLBACK } });
    } catch {
      // 그래도 실패 → 상태를 되돌려 다음 폴링에서 다시 시도 (이전 곡에 멈추는 것 방지)
      lastTrack = '';
      lastStart = 0;
      lastElapsed = 0;
      lastRepeat = '';
    }
  }
}
