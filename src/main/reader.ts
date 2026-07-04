import type { WebContents } from 'electron';

export interface NowPlaying {
  title: string;
  artist: string;
  album: string;
  cover: string | null;
  elapsed: number;
  duration: number;
  paused: boolean;
  repeat: string; // '' | 'NONE' | 'ALL' | 'ONE' (유튜브뮤직 플레이어 바의 repeat-mode)
  extra: string;  // 영상 키워드 + 설명란 앞부분(가사인 경우 많음) — 분위기 매칭 보조용
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

  // 반복 모드 (NONE / ALL / ONE) — 속성이 없으면 빈 문자열로 안전하게
  const playerBar = document.querySelector('ytmusic-player-bar');
  const repeat = (playerBar && playerBar.getAttribute('repeat-mode')) || '';

  // 곡이 바뀌면 이전 곡의 위치 보고값을 즉시 폐기한다.
  // (안 그러면 새 곡 시작 직후 최대 10초간 이전 곡의 시간·길이로 계산되는 버그)
  if (window.__meariLastTitle !== title) {
    window.__meariLastTitle = title;
    window.__meariPos = null;
  }

  // 분위기 매칭 보조: 영상 키워드 + 설명란 앞부분(가사가 실려 있는 경우가 많다)
  let extra = '';
  try {
    const mp = document.getElementById('movie_player');
    const pr = mp && mp.getPlayerResponse && mp.getPlayerResponse();
    const vd = pr && pr.videoDetails;
    if (vd) {
      const kw = Array.isArray(vd.keywords) ? vd.keywords.join(' ') : '';
      const ds = (vd.shortDescription || '').slice(0, 400);
      extra = (kw + ' ' + ds).slice(0, 800);
    }
  } catch (e) { /* 무시 */ }

  let elapsed, duration;
  const p = window.__meariPos;
  if (v.paused) {
    // 일시정지 중에는 video.currentTime 이 정확한 멈춘 위치다.
    // (setPositionState 보고값은 일시정지 중 탐색을 반영하지 않아 낡을 수 있음)
    elapsed = v.currentTime || 0;
    duration = v.duration || (p && p.duration) || 0;
  } else if (p && p.duration && Date.now() - p.at < 10000) {
    // 재생 중에는 최신 보고값 기반 외삽이 곡 전환 직후에도 정확하다.
    // 보고값이 10초 넘게 갱신되지 않았다면(일부 곡에서 안 부름) 신뢰하지 않는다.
    duration = p.duration;
    elapsed = p.position + (Date.now() - p.at) / 1000 * p.rate;
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
    paused: v.paused,
    repeat: repeat,
    extra: extra
  };
})()`;

export async function readNowPlaying(wc: WebContents): Promise<NowPlaying | null> {
  try {
    return await wc.executeJavaScript(READ_SCRIPT, true);
  } catch {
    return null; // 페이지 이동 중 등
  }
}
