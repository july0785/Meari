import { Client } from '@xhayper/discord-rpc';
import type { NowPlaying } from './reader';

let client: Client | null = null;
let ready = false;
let lastTrack = '';
let lastStart = 0; // 마지막으로 보낸 startTimestamp(ms). 재생위치 어긋남 감지용.

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
function cleanTitle(raw: string): string {
  let t = (raw || '').trim();
  t = t.replace(/^(\s*\[[^\]]*\]\s*)+/, '');                       // 앞쪽 [태그] 제거
  t = t.replace(
    /\s*[([]\s*(official[^)\]]*|m\/?v|mv|audio|lyrics?(\s*video)?|visualizer|가사|뮤직비디오|hd|4k|8k)\s*[)\]]\s*$/i,
    '',                                                            // 뒤쪽 (Official Video) 류 잡음 제거
  );
  t = t.replace(/\s+[-–—|｜]\s+.*$/, '');                          // " - 번역/부제", " | 설명" 꼬리 제거
  return t.trim() || (raw || '').trim();
}

// 유튜브 영상 썸네일(16:9)은 디스코드가 정사각형으로 잘라 보기 나쁘므로,
// 무료 이미지 CDN(weserv)으로 여백을 채워 정사각형으로 만든다.
// 이미 정사각인 앨범 아트(googleusercontent 등)는 그대로 둔다.
function coverImage(cover: string | null): string | null {
  if (!cover) return null;
  if (/ytimg\.com|\/vi\//.test(cover)) {
    const bare = cover.replace(/^https?:\/\//, '');
    return `https://images.weserv.nl/?url=${encodeURIComponent(bare)}&w=600&h=600&fit=contain&cbg=0d1421`;
  }
  return cover;
}

export async function updatePresence(np: NowPlaying | null): Promise<void> {
  if (!client || !ready || !client.user) return;

  // 곡없음 / 일시정지 → 활동 지움
  if (!np || np.paused || !np.title) {
    if (lastTrack !== '') {
      lastTrack = '';
      lastStart = 0;
      await client.user.clearActivity().catch(() => {});
    }
    return;
  }

  const now = Date.now();
  const track = `${np.title}|${np.artist}`;
  const hasDuration = Number.isFinite(np.duration) && np.duration > 0;
  const start = Math.floor(now - np.elapsed * 1000);

  // 갱신 조건: 곡이 바뀌었거나(제목·가수), 재생위치가 5초 이상 어긋났을 때.
  // 어긋남 감지는 ① 곡 전환 직후 stale 한 currentTime 보정, ② 사용자 탐색(seek) 반영에 쓰인다.
  // 정상 재생 중에는 start 가 거의 일정해 갱신이 안 나가므로 속도제한이 보호된다.
  const trackChanged = track !== lastTrack;
  const drifted = Math.abs(start - lastStart) > 5000;
  if (!trackChanged && !drifted) return;

  lastTrack = track;
  lastStart = start;

  await client.user.setActivity({
    type: 2, // Listening — 디스코드 판본에 따라 'Playing' 으로 보일 수 있음(정상)
    details: cleanTitle(np.title).slice(0, 128),
    state: np.artist.slice(0, 128),
    largeImageKey: coverImage(np.cover) ?? 'logo', // 정사각 보정된 URL; 없으면 업로드자산 'logo'
    largeImageText: (np.album || cleanTitle(np.title)).slice(0, 128),
    smallImageKey: 'logo',             // 소형이미지는 URL 불가 → 자산키
    startTimestamp: start,
    endTimestamp: hasDuration
      ? Math.floor(now + (np.duration - np.elapsed) * 1000)
      : undefined,
  }).catch(() => {});
}
