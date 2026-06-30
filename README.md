# 메아리 (Meari)

지금 듣고 있는 음악을 디스코드에 띄워주는 작은 데스크탑 프로그람입니다.

창 안에서 `music.youtube.com` 을 그대로 띄우고, 지금 재생 중인 곡의 정보(제목·가수·앨범그림·진행띠)를 읽어
**디스코드 Rich Presence** 로 보여줍니다. 브라우저 확장이나 native host 없이, 한 프로그람 안에서 전부 끝냅니다.

> 메아리 = 소리가 되돌아오는 것. 내가 듣는 음악이 디스코드로 메아리쳐 친구들에게 보입니다.

---

## 무엇을 하는가

- `music.youtube.com` 을 띄우는 단일 창 (구글 로그인 유지)
- 지금 재생곡 읽기: 제목·가수·앨범·앨범그림·경과/총 시간·일시정지 여부
- 디스코드 프로필에 Rich Presence 갱신 (곡이 바뀔 때만)
- 트레이 상주 (창을 닫으면 숨김, 종료는 트레이 메뉴에서)

초기판에 **없는 것**: 자체 재생 UI·가사·다운로드·테마·별도 설정창. (유튜브뮤직 웹을 그대로 씁니다.)

---

## 받기 / 빌드

### 요구사항
- **Node.js `≥ 20.19` 또는 `≥ 22.12`** — electron 43 의 바이너리 설치기(`@electron/get`)가 ESM 이라
  그보다 낮은 Node(예: 20.17)에서는 electron 바이너리가 안 받아져 `npm run dev` 가 막힙니다.
- 디스코드 데스크탑 클라이언트 (Rich Presence 표시용)
- 본인 명의의 디스코드 Application ID → 아래 [자기 디스코드 앱 만들기](#자기-디스코드-앱-만들기) 참고

### 개발 실행

```bash
# 1) 의존성 설치
npm install -D electron@latest electron-vite@latest electron-builder@latest typescript@latest @types/node@latest
npm install @xhayper/discord-rpc@latest

# 2) src/main/constants.ts 의 DISCORD_CLIENT_ID 를 본인 Application ID 로 채우기

# 3) 개발 실행
npm run dev
```

### 빌드물 만들기 (각 OS에서 그 OS용으로)

```bash
npm run dist:win   # 윈도우에서 → dist/ 에 nsis 설치본 + portable
npm run dist:mac   # 맥에서      → dist/ 에 dmg
```

> 코드서명은 하지 않습니다. 미서명 경고 대응은 [알려진 문제](#알려진-문제)를 보세요.

---

## 설정 (config.json)

설정은 브라우저 storage 가 아니라 OS의 userData 폴더에 있는 `config.json` 으로 관리됩니다.

| 위치 | 경로 |
|------|------|
| 윈도우 | `%APPDATA%/meari/config.json` |
| 맥 | `~/Library/Application Support/meari/config.json` |

| 키 | 기본값 | 뜻 |
|----|--------|----|
| `pollIntervalMs` | `3000` | 재생정보를 읽는 주기(밀리초). 낮추면 더 빠르게 반응하지만 부하가 늘어납니다. |

파일이 없으면 기본값으로 동작합니다. 예:

```json
{
  "pollIntervalMs": 3000,
  "discordClientId": "여기에_본인_Application_ID"
}
```

### 디스코드 Client ID 넣는 3가지 방법 (택1)

코드를 안 건드려도 됩니다. 우선순위는 **환경변수 > config.json > constants.ts** 입니다.

1. **환경변수** — `DISCORD_CLIENT_ID=12345... npm run dev` (또는 빌드물 실행 전 설정)
2. **config.json** — 위처럼 `discordClientId` 키에 넣기
3. **소스 기본값** — `src/main/constants.ts` 의 `DISCORD_CLIENT_ID` (빌드물에 박고 싶을 때)

> **왜 스포티파이처럼 자동이 안 되나요?** 디스코드의 스포티파이 표시는 디스코드에 *내장된 1급 공식 연동*이라
> 제3자 앱은 흉내 낼 수 없습니다. 제3자 앱이 활동을 띄우는 길은 Rich Presence(IPC) + Client ID 뿐입니다.
> 단, Client ID는 *사용자*가 아니라 *앱*을 식별하는 값이라, 만든 사람이 한 번만 넣으면 받는 사람은 아무 입력도 필요 없습니다.

---

## 디스코드 연동만 따로 테스트

유튜브뮤직 흐름 없이, 가짜 곡 하나를 디스코드에 띄워 Client ID·연결만 빠르게 확인합니다.

```bash
npm run test:presence -- <DISCORD_CLIENT_ID>
# 또는
DISCORD_CLIENT_ID=12345...  npm run test:presence
```

디스코드 데스크탑이 켜져 있어야 하며, 성공하면 프로필에 《테스트 곡 — 메아리》 활동이 진행띠와 함께 뜹니다.
`Ctrl+C` 로 종료하면 활동이 지워집니다. (이 스크립트는 `node` 만 쓰므로 electron/Node 판본 문제와 무관합니다.)

---

## 자기 디스코드 앱 만들기

포크하거나 직접 쓰려면 **본인 명의의 디스코드 Application** 이 필요합니다. (봇/토큰은 필요 없습니다 — IPC RPC는 Client ID만 씁니다.)

1. <https://discord.com/developers/applications> → **New Application** → 이름을 짓습니다.
   이 이름이 디스코드 활동에 표시되는 앱 이름이 됩니다 (예: `Meari`).
2. **Application ID** 를 복사해 넣습니다 (위 [3가지 방법](#디스코드-client-id-넣는-3가지-방법-택1) 중 택1 — 환경변수 / `config.json` / `constants.ts`).
3. 왼쪽 메뉴 **Rich Presence → Art Assets** 에서 이미지를 하나 올리고 이름을 `logo` 로 합니다.
   크기는 `1024×1024` 권장 (최소 `512×512`). 자산키는 소문자로 저장됩니다.
4. 디스코드 데스크탑 클라이언트를 켜두고,
   **사용자 설정 → 활동 개인정보 → 《현재 활동을 상태 메세지로 표시》** 를 켭니다.

---

## 알려진 문제

- **구글 로그인이 막힘**: 일렉트론 기본 UA에 `Electron/…` 토큰이 들어 있어 구글이 막을 수 있습니다.
  메아리는 UA에서 그 토큰을 제거해 Chrome 처럼 보이게 합니다. 그래도 《이 브라우저는 안전하지 않을 수 있습니다》가
  뜨면 최신 Chrome 데스크탑 UA 전체 문자렬을 넣어 보세요. `persist:main` 파티션 덕에 한 번 로그인하면 재시작 후에도 유지됩니다.
- **Listening 이 Playing 으로 보임**: IPC RPC에서 흔한 현상입니다. 정상으로 취급하고 억지로 고치려 하지 마세요.
- **미서명 경고**:
  - 윈도우: SmartScreen 경고 → 《추가 정보 → 실행》.
  - 맥: 《손상되여 열 수 없음》 이 뜨면 터미널에서
    ```bash
    xattr -cr "/Applications/Meari.app"
    ```
    를 실행한 뒤 다시 엽니다.
- **앨범그림이 안 뜸**: 앨범그림은 공개 https URL 이라야 합니다. 유튜브뮤직의 `googleusercontent` 류 URL은 공개라 그대로 됩니다.
  URL이 없을 때는 디스코드에 올려둔 자산키 `logo` 가 대신 표시됩니다.
- **빌드(electron-builder) 판본 고정**: `electron-builder` 는 `26.13.0` 으로 **정확히 고정**돼 있습니다.
  `26.15.x` 는 패밀리 패키지 판본이 어긋나 포장이 깨지므로(`spawnAndWriteWithOutput is not a function` /
  `@noble/hashes` ESM `require` 오류) `package.json` 에서 `^` 없이 고정했습니다. 함부로 올리지 마세요.
- **Node 판본이 낮으면 dev 가 안 뜸**: electron 43 + `@electron/get@5` 는 ESM 이라 Node `< 20.19` 에서는
  `require(ESM)` 이 막혀 electron 바이너리 postinstall 이 실패합니다(`ERR_REQUIRE_ESM` → `Electron uninstall`).
  - 해결: Node 를 `≥ 20.19`(LTS 안 패치) 또는 `≥ 22.12` 로 올린 뒤, 한 번만
    ```bash
    npm rebuild electron   # (또는 node_modules 지우고 npm install)
    npm run dev
    ```
  - `npm run build` / `npm run dist:win` 은 electron-builder 가 자체 다운로더를 써서 낮은 Node 에서도 됩니다.

---

## 만든 방법 / 기술

- TypeScript + Electron (electron-vite 개발/번들, electron-builder 포장)
- 디스코드: [`@xhayper/discord-rpc`](https://github.com/xhayper/discord-rpc)
- 렌더러 없음: 외부 사이트를 직접 적재하므로 main + preload 만 있습니다.
- MediaSession 메타데이터와 `<video>` 요소를 `executeJavaScript` 로 읽어 재생정보를 얻습니다.

---

## 라이선스

[MIT](LICENSE) © 2026 JULY

---

## 고지

> 본 프로그람은 구글(Google LLC) 및 유튜브와 아무런 제휴·승인·후원 관계가 없는 독립적인 비공식 도구입니다.
> 《YouTube》, 《YouTube Music》 및 관련 명칭·로고·상표는 각 소유자의 자산이며, 본 프로젝트에서의 언급은 식별·참고 목적일 뿐입니다.
> 본 프로그람은 《있는 그대로(AS IS)》 제공되며, 사용에 따르는 모든 책임은 사용자에게 있습니다.
>
> This project is not affiliated with, endorsed by, or sponsored by Google LLC or YouTube.
> "YouTube", "YouTube Music", and related names, logos, and trademarks are the property of their respective owners; any reference is for identification purposes only.
> This software is provided "AS IS", and you use it at your own risk.
