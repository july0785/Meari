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

  // 제목은 플레이어 바에 실제로 보이는 것을 우선 사용.
  // mediaSession 제목은 표시 제목과 달리 영문으로 표준화된 트랙명일 때가 있어
  // 원제목(일본어 등)이 유실된다. 플레이어 바가 비어 있으면 mediaSession 으로 폴백.
  const bar = document.querySelector('yt-formatted-string.title.ytmusic-player-bar')
    || document.querySelector('.title.ytmusic-player-bar');
  const title = (bar && bar.textContent && bar.textContent.trim()) || m.title || '';

  let elapsed, duration;
  const p = window.__meariPos;
  // 보고값이 10초 넘게 갱신되지 않았다면(일부 곡에서 setPositionState 를 안 부름) 신뢰하지 않는다
  const fresh = p && p.duration && (v.paused || Date.now() - p.at < 10000);
  if (fresh) {
    duration = p.duration;
    elapsed = v.paused ? p.position : p.position + (Date.now() - p.at) / 1000 * p.rate;
    if (elapsed < 0) elapsed = 0;
    if (elapsed > duration) elapsed = duration;
  } else {
    elapsed = v.currentTime || 0;
    duration = v.duration || 0;
  }

  return {
    title: title,
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
