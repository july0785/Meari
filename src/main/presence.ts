import { Client } from '@xhayper/discord-rpc';
import type { NowPlaying } from './reader';

let client: Client | null = null;
let ready = false;
let lastTrack = '';

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
