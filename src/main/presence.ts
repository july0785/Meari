import { Client } from '@xhayper/discord-rpc';
import { execFile } from 'node:child_process';
import { writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from './config';
import type { NowPlaying } from './reader';

let client: Client | null = null;
let ready = false;
let lastTrack = '';
let lastStart = 0;    // 마지막으로 보낸 startTimestamp(ms). 재생위치 어긋남 감지용.
let lastPaused = false;
let lastElapsed = 0;  // 마지막 전송 시점의 재생위치(초). 일시정지 중 탐색 감지용.
let lastRepeat = '';  // 마지막 전송 시점의 반복 모드. 뱃지 갱신 감지용.
let lastHadDuration = false; // 곡 시작 직후 길이를 못 읽고 보냈다가 나중에 알게 되면 재전송

// 저장소에 올려 둔 상태 뱃지 아이콘 (공개 https 라 디스코드가 그대로 가져간다)
const ICON_BASE = 'https://raw.githubusercontent.com/july0785/Meari/main/resources';
const COVER_FALLBACK = `${ICON_BASE}/icon.png`;       // 앨범 이미지가 없을 때
// ?v= 는 디스코드 이미지 캐시 우회용 — 아이콘을 갈아끼우면 숫자를 올릴 것
const BADGE_PAUSE = `${ICON_BASE}/badge-pause.png?v=3`;
const BADGE_REPEAT = `${ICON_BASE}/badge-repeat.png?v=3`;
const BADGE_REPEAT_ONE = `${ICON_BASE}/badge-repeat-one.png?v=3`;
let rawTitleMode = false; // config.rawTitle: 제목 정리 끄기
let videoCoverMode: 'mix' | 'scenery' | 'crop' = 'mix'; // config.videoCover: 영상 썸네일 처리 방식

export async function initPresence(clientId: string): Promise<void> {
  const cfg = loadConfig();
  rawTitleMode = Boolean(cfg.rawTitle);
  videoCoverMode = cfg.videoCover === 'crop' ? 'crop' : cfg.videoCover === 'scenery' ? 'scenery' : 'mix';
  void loadSceneryList(); // 사용자 사진 목록 (백그라운드 — 실패해도 폴백으로 동작)
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

function hashOf(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

// 사용자가 저장소 scenery/ 폴더에 넣어 둔 사진 목록 (시작 시 한 번 읽음).
// 사진을 추가/교체하면 앱 재시작만으로 반영된다 — 재빌드 불필요.
// 파일명 토큰은 분위기 태그로 쓴다 (예: "밤_평양야경.jpg" → 태그 [밤, 평양야경]).
let sceneryList: Array<{ tags: string[]; url: string }> = [];

async function loadSceneryList(): Promise<void> {
  try {
    // 하위 폴더까지 한 번에 읽기 위해 트리 API 사용 (scenery/밤/사진.jpg 식 분류 지원)
    const res = await fetch('https://api.github.com/repos/july0785/Meari/git/trees/main?recursive=1');
    if (!res.ok) return;
    const data = (await res.json()) as { tree?: Array<{ path?: string; type?: string }> };
    if (!Array.isArray(data.tree)) return;
    sceneryList = data.tree
      .filter((e) =>
        e.type === 'blob' && typeof e.path === 'string' &&
        e.path.startsWith('scenery/') && /\.(png|jpe?g|webp)$/i.test(e.path))
      .map((e) => {
        const rel = e.path!.slice('scenery/'.length);
        const parts = rel.split('/');
        const base = parts[parts.length - 1].replace(/\.[^.]+$/, '');
        // 태그 = 중간 폴더 이름들 + 파일명 토큰들
        const rawTags = [...parts.slice(0, -1), ...base.split(/[-_\s]+/)]
          .map((t) => t.toLowerCase())
          .filter((t) => t.length >= 2 || /[가-힣]/.test(t));
        const url = `https://raw.githubusercontent.com/july0785/Meari/main/scenery/${parts.map(encodeURIComponent).join('/')}`;
        return { tags: expandTags(rawTags), url };
      })
      .filter((e) => e.url.length <= MAX_IMAGE_URL);
  } catch { /* 목록 실패 → 폴백 사용 */ }
}

// 분위기 어휘 사전: 폴더/파일명 태그가 곡 제목·가수·앨범·가사와 직접 안 겹쳐도
// 같은 "계열"의 낱말로 걸리게 한다. 어두운 계열 → 밤, 밝은 계열 → 낮 처럼
// 정서 어휘까지 폭넓게 깔아 둔다. 표준 한국어 기준 + 영어·일본어, 북한어는 보조.
// (완전한 의미 이해는 아니고 큰 사전 — 필요한 낱말은 계속 추가)
const TAG_SYNONYMS: Record<string, string[]> = {
  '밤': [
    // 한국어
    '밤', '야경', '야간', '심야', '한밤', '야밤', '자정', '새벽', '여명', '달', '달빛', '달밤', '보름달',
    '초승달', '별', '별빛', '별밤', '별자리', '은하수', '저녁', '어스름', '불야성', '어둠', '어두운',
    '그림자', '그늘', '촛불', '등불', '침묵', '적막', '눈물', '슬픔', '슬픈', '이별', '그리움', '그리워',
    '쓸쓸', '고독', '외로움', '외로운', '애수', '서글픈', '탄식', '추억', '잠들', '꿈길', '자장가', '악몽',
    // 영어
    'night', 'moon', 'moonlight', 'midnight', 'star', 'starlight', 'dark', 'darkness', 'shadow',
    'lonely', 'tears', 'sad', 'sorrow', 'farewell', 'goodbye', 'lullaby',
    // 일본어
    '夜', '夜空', '真夜中', '月', '月夜', '星', '星空', '闇', '夕闇', '涙', '影', '孤独', 'さよなら', '別れ',
    // 북한어(보조)
    '리별',
  ],
  '낮': [
    '낮', '한낮', '정오', '아침', '새아침', '일출', '해돋이', '햇빛', '햇살', '아침햇살', '태양', '광명',
    '새날', '빛나', '밝은', '환한', '눈부신', '찬란', '맑은', '청명', '활짝', '웃음', '미소', '명랑',
    '기쁨', '기쁜', '희망', '행복', '힘차게', '앞날', '미래', '푸른하늘', '파란하늘', '창공',
    'day', 'daylight', 'morning', 'sunrise', 'sunshine', 'sunny', 'bright', 'happy', 'hope', 'smile',
    '朝', '太陽', '陽射し', '光', '昼', '青空', '笑顔', '希望', '未来',
    '해빛',
  ],
  '노을': [
    '노을', '저녁노을', '저녁놀', '붉은노을', '놀빛', '석양', '일몰', '황혼', '해질녘', '해질무렵', '붉은하늘',
    'sunset', 'dusk', 'twilight',
    '夕焼け', '夕日', '夕暮れ', '黄昏',
  ],
  '인공물': [
    '인공물', '도시', '거리', '건물', '빌딩', '다리', '탑', '기념비', '동상', '분수', '등대', '공장',
    '철길', '기차역', '정거장', '열차', '기차', '지하철', '전차', '광장', '고층', '아파트',
    '마을', '기와집', '새집', '양식장', '발전소', '용광로', '제철', '탄광', '광산', '건설', '기중기',
    'city', 'tower', 'bridge', 'building', 'factory', 'station', 'train',
    '街', '駅', '都会', 'ビル',
    '살림집', '유원지', '양어장',
  ],
  '자연물': [
    '자연물', '자연', '강', '강변', '냇가', '시냇물', '호수', '들', '들판', '벌판', '초원', '숲', '수림',
    '폭포', '바위', '계곡', '언덕', '밭', '논밭', '시골', '전원', '농촌', '농사', '농장', '과수원',
    '목장', '온실', '트랙터', '수확', '저수지', '물길',
    'nature', 'river', 'lake', 'forest', 'field', 'meadow', 'valley', 'hill', 'farm',
    '川', '森', '湖', '野原', '草原', '谷',
    '시내물', '포전', '남새', '가을걷이', '협동농장', '뜨락또르',
  ],
  '바다': [
    '바다', '바닷가', '해변', '백사장', '파도', '물결', '항구', '항해', '뱃길', '해안', '섬', '수평선',
    '갈매기', '돛', '어선', '만선',
    'sea', 'ocean', 'wave', 'beach', 'sail', 'harbor',
    '海', '波', '港', '渚', '潮風',
  ],
  '산': [
    '산', '산맥', '산줄기', '고원', '봉우리', '고개', '백두', '백두산', '금강', '금강산', '한라산', '설악',
    'mountain', 'peak', 'summit',
    '山', '峰', '高原',
    '고지', '령길',
  ],
  '꽃': [
    '꽃', '꽃잎', '꽃길', '꽃밭', '봄', '봄날', '벚꽃', '개나리', '진달래', '매화', '장미', '목련', '향기',
    '만개', '만발',
    'flower', 'spring', 'blossom', 'rose', 'petal',
    '花', '桜', 'さくら', '花びら', '春',
    '목란', '꽃보라',
  ],
  '눈': [
    '눈', '첫눈', '함박눈', '백설', '설경', '눈꽃', '눈보라', '겨울', '한겨울', '서리',
    'winter', 'snow', 'snowflake',
    '雪', '初雪', '粉雪', '冬',
  ],
  '비': [
    '비', '빗물', '빗소리', '빗속', '이슬비', '가랑비', '소나기', '폭우', '장마',
    'rain', 'rainy', 'raindrop',
    '雨', '梅雨', '雨音', '雫',
  ],
  '사랑': [
    '사랑', '그대', '당신', '연인', '애인', '연애', '고백', '첫사랑', '짝사랑', '사모', '연정', '정든',
    '정다운', '마음속', '설레', '두근', '연가', '세레나데',
    'love', 'romance', 'darling', 'sweetheart', 'kiss', 'heart',
    '恋', '愛', '恋人', '君', '好きだ', '大好き',
    '님이여',
  ],
  '조국': [
    '조국', '고국', '나라', '내나라', '고향', '강산', '산하', '금수강산', '삼천리', '통일', '겨레',
    '민족', '동포', '애국', '향토',
    'homeland', 'motherland',
    '故郷', 'ふるさと',
    '어머니조국', '내조국', '두만강', '압록강', '대동강', '모란봉',
  ],
  '혁명': [
    '혁명', '투쟁', '전사', '병사', '군대', '군인', '전투', '함성', '승리', '진격', '항쟁', '봉기', '군가',
    'march', 'victory', 'soldier', 'battle',
    '戦い', '革命',
    '진군', '열병', '결전', '포성', '총대', '장군', '원수', '수령', '당기', '붉은기', '돌격', '격전',
    '기치', '사수', '유격대', '빨치산', '포화', '총검',
  ],
  '도시': [
    '도시', '도심', '거리', '네온', '빌딩', '불빛', '광장', '지하철', '전차', '서울',
    'city', 'street', 'neon', 'downtown',
    '街', '都会', 'ネオン', '東京',
    '평양', '려명',
  ],
  '흥겨움': [
    '축제', '잔치', '명절', '경사', '축하', '파티', '춤', '아리랑', '신나', '신난다', '흥겨', '환희',
    '환호', '만세', '박수', '웃음꽃', '풍년',
    'festival', 'dance', 'party', 'celebration', 'carnival',
    '祭', '祭り', 'お祭り',
    '노래자랑', '덩실', '경축', '축포', '대풍',
  ],
};

function expandTags(tags: string[]): string[] {
  const out = new Set<string>(tags);
  for (const t of tags) {
    for (const words of Object.values(TAG_SYNONYMS)) {
      if (words.includes(t)) words.forEach((w) => out.add(w));
    }
  }
  return [...out];
}

// 분위기 매칭: 태그가 곡 텍스트에 들어 있는 사진을 우선 배정.
// 가장 많이 일치하는 사진(들) 중에서 "곡 시드(제목|가수)" 해시로 하나를 고정 선택한다.
// 주의: 선택 해시에 매칭 텍스트(hay)를 쓰면 같은 채널의 상용구 설명란 때문에
// 모든 곡이 같은 사진으로 수렴한다 — 반드시 곡 시드로 뽑을 것.
function matchScenery(hay: string, seed: string): string | null {
  if (sceneryList.length === 0 || !hay) return null;
  const h = hay.toLowerCase();
  let best: string[] = [];
  let bestScore = 0;
  for (const e of sceneryList) {
    const score = e.tags.reduce((n, t) => n + (h.includes(t) ? 1 : 0), 0);
    if (score > bestScore) { bestScore = score; best = [e.url]; }
    else if (score === bestScore && score > 0) best.push(e.url);
  }
  return bestScore > 0 ? best[hashOf(seed) % best.length] : null;
}

// 곡별 고정 풍경 선택: scenery/ 폴더 사진 우선, 비어 있으면 임시로 Lorem Picsum 실사.
// (picsum 은 302 리다이렉트를 주므로 weserv 로 감싸 직접 200 응답으로 만든다)
function sceneryUrl(seed: string): string {
  const n = hashOf(seed);
  if (sceneryList.length > 0) return sceneryList[n % sceneryList.length].url;
  return `https://images.weserv.nl/?url=${encodeURIComponent(`picsum.photos/seed/meari-${n.toString(36)}/600/600`)}`;
}

// 썸네일에 글씨가 있는지 윈도우 내장 OCR 로 판별한다 (곡별 1회, 결과 캐시).
// 글씨가 있으면 크롭 시 훼손되므로 풍경으로, 없으면 크롭해도 안전하다.
// 실패·비윈도우 환경은 보수적으로 "글씨 있음" 취급 → 풍경.
const thumbTextCache = new Map<string, Promise<boolean>>();

function ocrScriptPath(): string | null {
  const candidates = [
    join(process.resourcesPath ?? '', 'ocr-thumb.ps1'),          // 패키지본(extraResources)
    join(__dirname, '../../resources/ocr-thumb.ps1'),            // 개발
  ];
  for (const p of candidates) {
    try { if (existsSync(p)) return p; } catch { /* 다음 후보 */ }
  }
  return null;
}

function thumbHasText(videoId: string): Promise<boolean> {
  const cached = thumbTextCache.get(videoId);
  if (cached) return cached;
  const p = (async (): Promise<boolean> => {
    if (process.platform !== 'win32') return true;
    const script = ocrScriptPath();
    if (!script) return true;
    const tmp = join(tmpdir(), `meari-thumb-${videoId}.jpg`);
    try {
      const res = await fetch(`https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`);
      if (!res.ok) return true;
      writeFileSync(tmp, Buffer.from(await res.arrayBuffer()));
      const text = await new Promise<string>((resolve) => {
        execFile(
          'powershell.exe',
          ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, tmp],
          { timeout: 15000, windowsHide: true },
          (_err, stdout) => resolve(stdout ?? ''),
        );
      });
      return text.replace(/\s/g, '').length >= 4; // 4자 이상 인식되면 글씨 있는 썸네일
    } catch {
      return true;
    } finally {
      try { unlinkSync(tmp); } catch { /* 무시 */ }
    }
  })();
  thumbTextCache.set(videoId, p);
  return p;
}

// 영상(16:9) 썸네일은 정사각으로 만들기 애매하다: 크롭은 내용이 잘리고, 레터박스는 휑하다.
// 기본(mix=자동): 분위기 태그 일치 → 풍경 / 글씨 있는 썸네일 → 풍경 / 글씨 없는 썸네일 → 스마트 크롭.
// config.videoCover='scenery' 는 항상 풍경, 'crop' 은 항상 크롭.
// 크롭 시 썸네일 URL 의 긴 쿼리(?sqp=...)는 버리고 영상 ID 기반의 짧은 표준 URL 로 재구성
// (안 그러면 인코딩 후 256자를 넘겨 활동 갱신이 통째로 실패한다).
// 이미 정사각인 앨범 아트(googleusercontent 등)는 그대로 둔다.
async function coverImage(cover: string | null, seed: string, primary: string, extra: string): Promise<string | null> {
  if (!cover) return null;
  if (/ytimg\.com|\/vi\//.test(cover)) {
    const m = cover.match(/\/vi\/([^/?#]+)\//);
    if (videoCoverMode !== 'crop') {
      // 분위기 매칭 2단계: ① 제목·가수·앨범(정확) → ② 영상 키워드·설명란 가사(폭넓음)
      const mood = matchScenery(primary, seed) ?? matchScenery(extra, seed);
      if (mood) return mood;
      if (videoCoverMode === 'scenery') return sceneryUrl(seed);
      // mix(자동): 글씨 있는 썸네일은 잘리면 훼손 → 풍경. 글씨 없으면 크롭 진행.
      if (!m || (await thumbHasText(m[1]))) return sceneryUrl(seed);
    }
    if (!m) return null; // 영상 ID를 못 찾으면 로고로 대체
    // hqdefault 는 4:3 이라 검은 띠가 이미지에 구워져 있음 → 진짜 16:9 인
    // maxresdefault 를 쓰고, 없는 영상은 mqdefault(항상 존재)로 자동 대체
    const primaryThumb = encodeURIComponent(`i.ytimg.com/vi/${m[1]}/maxresdefault.jpg`);
    const fallbackThumb = encodeURIComponent(`i.ytimg.com/vi/${m[1]}/mqdefault.jpg`);
    const url = `https://images.weserv.nl/?url=${primaryThumb}&default=${fallbackThumb}&w=600&h=600&fit=cover&a=attention`;
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
  const durationChanged = hasDuration !== lastHadDuration; // 총 길이를 뒤늦게 알게 된 경우 진행 바 복구
  if (!trackChanged && !pausedChanged && !drifted && !pausedSeeked && !repeatChanged && !durationChanged) return;

  lastTrack = track;
  lastPaused = np.paused;
  lastElapsed = np.elapsed;
  lastRepeat = np.repeat;
  lastHadDuration = hasDuration;
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
    large_image: (await coverImage(np.cover, track, `${np.title} ${np.artist} ${np.album}`, np.extra || '')) ?? COVER_FALLBACK,
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
