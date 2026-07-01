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
  const ms = navigator.mediaSession;

  // MediaSession.setPositionState 훅(최초 1회) — 유튜브뮤직이 보고하는 정확한 재생위치를 캡처한다.
  // <video>.currentTime 은 곡 전환 순간 이전 곡 값이 남아 부정확하므로, 가능하면 이 값을 우선 사용한다.
  if (ms && ms.setPositionState && !window.__meariHook) {
    window.__meariHook = true;
    const orig = ms.setPositionState.bind(ms);
    ms.setPositionState = (st) => {
      try {
        window.__meariPos = st
          ? { duration: st.duration || 0, position: st.position || 0, rate: st.playbackRate || 1, at: Date.now() }
          : null;
      } catch (e) { /* 무시 */ }
      return orig(st);
    };
  }

  const m = ms && ms.metadata;
  const v = document.querySelector('video');
  if (!m || !v) return null;
  const art = (m.artwork && m.artwork.length)
    ? m.artwork[m.artwork.length - 1].src
    : null;

  let elapsed, duration;
  const p = window.__meariPos;
  if (p && p.duration) {
    duration = p.duration;
    elapsed = v.paused ? p.position : p.position + (Date.now() - p.at) / 1000 * p.rate;
    if (elapsed < 0) elapsed = 0;
    if (elapsed > duration) elapsed = duration;
  } else {
    elapsed = v.currentTime || 0;
    duration = v.duration || 0;
  }

  return {
    title: m.title || '',
    artist: m.artist || '',
    album: m.album || '',
    cover: art,
    elapsed: elapsed,
    duration: duration,
    paused: v.paused
  };
})()`;

export async function readNowPlaying(wc: WebContents): Promise<NowPlaying | null> {
  try {
    return await wc.executeJavaScript(READ_SCRIPT, true);
  } catch {
    return null; // 페이지 이동 중 등
  }
}
