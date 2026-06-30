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
