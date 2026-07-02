import { Client } from '@xhayper/discord-rpc';
import type { NowPlaying } from './reader';

let client: Client | null = null;
let ready = false;
let lastTrack = '';
let lastStart = 0;    // 마지막으로 보낸 startTimestamp(ms). 재생위치 어긋남 감지용.
let lastPaused = false;

export async function initPresence(clientId: string): Promise<void> {
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
  let t = original;

  // [태그]·【태그】 제거 (앞쪽 연속 태그 + 어디에 있든 【COVER】【MV】 류)
  t = t.replace(/^(\s*[[【][^\]】]*[\]】]\s*)+/, '');
  t = t.replace(/【[^】]*】/g, ' ');

  // (Official Video) (MV) (가사) 류 잡음 괄호 제거
  t = t.replace(
    /\s*[([]\s*(official[^)\]]*|m\/?v|mv|audio|lyrics?(\s*video)?|visualizer|가사|뮤직비디오|커버|cover|hd|4k|8k)\s*[)\]]/gi,
    ' ',
  );

  // 외국어 병기 괄호 제거: 괄호 밖에 한글이 있는데 괄호 안에 한글이 없으면
  // 병기(예: 초계반(アスノヨゾラ哨戒班), 아카네 리제(Akane Lize))로 간주한다.
  if (/[가-힣]/.test(t.replace(/[(（][^)）]*[)）]/g, ''))) {
    t = t.replace(/\s*[(（]([^)）]*)[)）]/g, (m, inner) => (/[가-힣]/.test(inner) ? m : ' '));
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
        return !(np.length >= 2 && (a.includes(np) || np.includes(a)));
      });
      if (noArtist.length > 0) kept = noArtist;
    }
    if (kept.length > 1 && kept.some((p) => /[가-힣]/.test(p))) {
      const hangulOnly = kept.filter((p) => /[가-힣]/.test(p));
      if (hangulOnly.length > 0) kept = hangulOnly;
    }
    if (kept.length > 0 && kept.length < parts.length) t = kept.join(' - ');
  }

  t = t.replace(/\s{2,}/g, ' ').trim();
  return t || original;
}

// 디스코드 largeImageKey 는 최대 256자. 넘으면 setActivity 전체가 실패하므로 반드시 지킨다.
const MAX_IMAGE_URL = 256;

// 유튜브 영상 썸네일(16:9)은 디스코드가 정사각형으로 잘라 보기 나쁘므로,
// 무료 이미지 CDN(weserv)으로 여백을 채워 정사각형으로 만든다.
// 이때 썸네일 URL 의 긴 쿼리(?sqp=...)는 버리고 영상 ID 기반의 짧은 표준 URL 로 재구성한다
// (안 그러면 인코딩 후 256자를 넘겨 활동 갱신이 통째로 실패한다).
// 이미 정사각인 앨범 아트(googleusercontent 등)는 그대로 둔다.
function coverImage(cover: string | null): string | null {
  if (!cover) return null;
  if (/ytimg\.com|\/vi\//.test(cover)) {
    const m = cover.match(/\/vi\/([^/?#]+)\//);
    if (!m) return null; // 영상 ID를 못 찾으면 로고로 대체
    const bare = `i.ytimg.com/vi/${m[1]}/hqdefault.jpg`;
    const url = `https://images.weserv.nl/?url=${encodeURIComponent(bare)}&w=600&h=600&fit=contain&cbg=0d1421`;
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
  if (!trackChanged && !pausedChanged && !drifted) return;

  lastTrack = track;
  lastPaused = np.paused;
  if (!np.paused) lastStart = start;

  // 디스코드는 details/state 가 2자 미만이면 거부한다 → 짧으면 여백으로 채움
  const pad2 = (s: string): string => (s.length < 2 ? (s + '  ').slice(0, 2) : s);
  const title = pad2(cleanTitle(np.title, np.artist).slice(0, 128));
  const artist = pad2((np.artist || 'YouTube Music').slice(0, 128));

  const activity = {
    type: 2, // Listening — 디스코드 판본에 따라 'Playing' 으로 보일 수 있음(정상)
    details: title,
    state: artist,
    largeImageKey: coverImage(np.cover) ?? 'logo', // 정사각 보정된 URL; 없으면 업로드자산 'logo'
    largeImageText: pad2((np.album || cleanTitle(np.title, np.artist)).slice(0, 128)),
    smallImageKey: 'logo',             // 소형이미지는 URL 불가 → 자산키
    smallImageText: np.paused ? '일시정지' : undefined,
    // 재생 중일 때만 진행 바(타임스탬프). 일시정지 땐 곡만 보여 주고 바는 멈춘다.
    startTimestamp: np.paused ? undefined : start,
    endTimestamp: (!np.paused && hasDuration)
      ? Math.floor(now + (np.duration - np.elapsed) * 1000)
      : undefined,
  };

  try {
    await client.user.setActivity(activity);
  } catch {
    // 커버 URL 문제일 수 있으니 업로드 자산(logo)으로 1회 재시도
    try {
      await client.user.setActivity({ ...activity, largeImageKey: 'logo' });
    } catch {
      // 그래도 실패 → 상태를 되돌려 다음 폴링에서 다시 시도 (이전 곡에 멈추는 것 방지)
      lastTrack = '';
      lastStart = 0;
    }
  }
}
