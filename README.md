# 메아리 (Meari)

지금 유튜브 뮤직에서 듣고 있는 노래를 **디스코드 프로필에 자동으로 띄워 주는** 작은 데스크톱 앱입니다.

창 하나에 `music.youtube.com` 을 그대로 띄우고, 재생 중인 곡의 제목·가수·앨범 이미지·진행 상태를 읽어
**디스코드 Rich Presence** 로 보여 줍니다. 브라우저 확장이나 별도 프로그램 없이, 앱 하나로 끝납니다.

> 메아리 = 소리가 되돌아오는 것. 내가 듣는 음악이 디스코드로 메아리쳐 친구들에게 보입니다.

---

## 주요 기능

- 유튜브 뮤직을 띄우는 단일 창 (구글 로그인 유지)
- 재생 중인 곡 정보 읽기: 제목 · 가수 · 앨범 · 앨범 이미지 · 경과/전체 시간 · 일시정지 여부
- 디스코드 프로필에 Rich Presence 표시 (곡이 바뀔 때만 갱신)
- 트레이 상주 (창을 닫으면 숨김, 종료는 트레이 메뉴에서)

처음 버전에 **없는 것**: 자체 재생 UI · 가사 · 다운로드 · 테마 · 별도 설정 창. (유튜브 뮤직 웹을 그대로 사용합니다.)

---

## 받기 / 실행

### 1) 바로 실행 (가장 쉬움)

빌드된 실행 파일은 자체적으로 필요한 런타임을 포함하고 있어, **별도 설치 없이 바로 실행**됩니다.

- `메아리 1.0.0.exe` — 포터블 (더블클릭)
- `메아리 Setup 1.0.0.exe` — 설치 버전

> 디스코드 표시를 보려면 디스코드 데스크톱 앱이 켜져 있어야 하고, 디스코드 애플리케이션 ID가 설정되어 있어야 합니다.
> (아래 [디스코드 연동](#디스코드-연동) 참고)

### 2) 개발 모드로 실행

```bash
npm install            # 의존성 설치
npm run dev            # 개발 모드 실행
```

> **Node.js 버전 주의:** electron 43 의 설치 과정이 ESM 기반이라, 개발 모드 실행에는 **Node.js `20.19` 이상 또는 `22.12` 이상**이 필요합니다.
> 더 낮은 버전에서는 electron 바이너리 내려받기에서 멈춥니다. (빌드/패키징은 더 낮은 버전에서도 동작합니다.)

---

## 빌드

각 운영체제에서 해당 OS용으로 만듭니다.

```bash
npm run build          # 메인/프리로드 번들만
npm run dist:win       # 윈도우 설치본 + 포터블 → dist/
npm run dist:mac       # 맥 dmg → dist/
```

코드 서명은 하지 않습니다. 서명되지 않은 앱 경고에 대한 대처는 [알려진 문제](#알려진-문제)를 참고하세요.

---

## 설정 (config.json)

설정은 브라우저 저장소가 아니라 운영체제의 사용자 데이터 폴더에 있는 `config.json` 으로 관리합니다.

| 운영체제 | 경로 |
|------|------|
| 윈도우 | `%APPDATA%/meari/config.json` |
| 맥 | `~/Library/Application Support/meari/config.json` |

| 키 | 기본값 | 설명 |
|----|--------|------|
| `pollIntervalMs` | `3000` | 재생 정보를 읽는 주기(밀리초). 낮추면 더 빠르게 반응하지만 부하가 늘어납니다. |
| `discordClientId` | (없음) | 디스코드 애플리케이션 ID. 비워 두면 코드에 내장된 기본값을 사용합니다. |

예시:

```json
{
  "pollIntervalMs": 3000,
  "discordClientId": "여기에_본인_애플리케이션_ID"
}
```

---

## 디스코드 연동

### 왜 애플리케이션 ID가 필요한가요?

디스코드의 "스포티파이 듣는 중" 표시는 디스코드에 **내장된 공식 연동**이라, 외부 앱은 그 방식을 그대로 쓸 수 없습니다.
메아리 같은 외부 앱이 활동을 띄우는 길은 **Rich Presence + 애플리케이션 ID** 뿐입니다.

여기서 애플리케이션 ID는 *사용자*가 아니라 *앱*을 식별하는 **공개 숫자**입니다. 비밀번호나 토큰이 아니므로 공개되어도 안전합니다.
만든 사람이 한 번만 넣어 두면, 받아서 쓰는 사람은 아무것도 입력할 필요가 없습니다.

### 애플리케이션 ID 넣는 3가지 방법 (택1)

우선순위는 **환경변수 > config.json > 코드 내장값** 입니다.

1. **환경변수** — `DISCORD_CLIENT_ID=12345... npm run dev`
2. **config.json** — 위 설정 표의 `discordClientId` 키에 입력
3. **코드 내장값** — `src/main/constants.ts` 의 `DISCORD_CLIENT_ID` (배포본에 박아 두고 싶을 때)

### 본인 디스코드 앱 만들기

1. <https://discord.com/developers/applications> 접속 → 디스코드 계정 로그인
2. 오른쪽 위 **New Application** → 이름 입력(예: `메아리`) → 약관 동의 → **Create**
   - 여기서 정한 이름이 디스코드 활동에 "○○ 듣는 중" 으로 표시됩니다. 한국어 이름도 됩니다.
3. **General Information** 의 **Application ID** 를 복사 → 위 방법 중 하나로 넣기
4. *(선택)* 앨범 이미지가 없을 때 대신 보여 줄 로고: 왼쪽 **Rich Presence → Art Assets** 에서
   `resources/discord-logo.png` 를 올리고 이름을 `logo` 로 저장 (권장 크기 `1024×1024`)
5. 디스코드 데스크톱 앱: **사용자 설정 → 활동 개인정보 → "현재 활동을 상태 메시지로 표시"** 켜기

> 봇이나 토큰은 필요 없습니다. IPC 기반 Rich Presence 는 애플리케이션 ID만 사용합니다.

### 표시되는 모습

곡을 재생하면 디스코드 프로필에 활동 종류 "듣는 중", 곡 제목·가수, 앨범 이미지, 진행 바가 함께 표시됩니다.
앨범 이미지는 유튜브 뮤직의 공개 이미지 주소를 그대로 사용하므로 따로 올릴 필요가 없습니다.

---

## 디스코드 연동만 따로 테스트

유튜브 뮤직 흐름 없이, 가짜 곡 하나를 디스코드에 띄워 애플리케이션 ID와 연결만 빠르게 확인합니다.

```bash
npm run test:presence -- <애플리케이션_ID>
# 또는
DISCORD_CLIENT_ID=12345...  npm run test:presence
```

디스코드 데스크톱 앱이 켜져 있어야 하며, 성공하면 프로필에 "테스트 곡 — 메아리" 활동이 진행 바와 함께 표시됩니다.
`Ctrl+C` 로 종료하면 활동이 지워집니다. (이 스크립트는 `node` 만 사용하므로 electron/Node 버전 문제와 무관합니다.)

---

## 동작 원리 (요약)

- `BrowserWindow` 로 유튜브 뮤직을 띄우고, `persist:main` 파티션으로 로그인 세션을 유지합니다.
- 일렉트론 기본 User-Agent 에는 `Electron` 토큰이 들어 있어 구글 로그인이 막히므로, 이 토큰을 제거해 일반 크롬처럼 보이게 합니다.
- 재생 정보는 페이지의 `navigator.mediaSession.metadata` 와 `<video>` 요소에서 읽습니다.
  격리된 프리로드에서는 보이지 않으므로, 메인 프로세스의 `executeJavaScript` 로 원본 컨텍스트 값을 읽습니다.
- 곡(또는 재생/정지 상태)이 바뀔 때만 디스코드 활동을 갱신합니다. (속도 제한 보호 및 깜빡임 방지)

렌더러는 만들지 않습니다. 외부 사이트를 직접 띄우므로 메인 + 프리로드만 있습니다.

---

## 알려진 문제

- **구글 로그인이 막힐 때**: User-Agent 에서 `Electron` 토큰을 제거해 회피합니다.
  그래도 "이 브라우저는 안전하지 않을 수 있습니다" 가 뜨면 최신 크롬 데스크톱 User-Agent 전체 문자열을 넣어 보세요.
  `persist:main` 파티션 덕분에 한 번 로그인하면 재시작 후에도 유지됩니다.
- **"듣는 중" 이 "게임 중" 으로 보일 때**: IPC 기반 Rich Presence 에서 종종 나타나는 현상입니다.
  곡 정보와 앨범 이미지는 정상적으로 표시되니 그대로 두면 됩니다.
- **서명되지 않은 앱 경고**:
  - 윈도우: SmartScreen 경고 → "추가 정보 → 실행".
  - 맥: "손상되어 열 수 없음" 이 뜨면 터미널에서 아래를 실행한 뒤 다시 엽니다.
    ```bash
    xattr -cr "/Applications/메아리.app"
    ```
- **앨범 이미지가 안 보일 때**: 앨범 이미지는 공개 https 주소여야 합니다.
  유튜브 뮤직의 `googleusercontent` 계열 주소는 공개라 그대로 표시됩니다. 주소가 없을 때는 업로드해 둔 `logo` 자산이 대신 표시됩니다.
- **electron-builder 버전 고정**: `electron-builder` 는 `26.13.0` 으로 **정확히 고정**되어 있습니다.
  `26.14` 이상은 패키지 의존성이 어긋나 패키징이 깨지므로, `package.json` 에서 `^` 없이 고정했습니다. 임의로 올리지 마세요.

---

## 기술 스택

- TypeScript + Electron (electron-vite 로 개발/번들, electron-builder 로 패키징)
- 디스코드: [`@xhayper/discord-rpc`](https://github.com/xhayper/discord-rpc)
- 렌더러 없이 메인 + 프리로드만 사용

---

## 라이선스

[MIT](LICENSE) © 2026 JULY

---

## 고지

> 본 프로그램은 구글(Google LLC) 및 유튜브와 아무런 제휴·승인·후원 관계가 없는 독립적인 비공식 도구입니다.
> "YouTube", "YouTube Music" 및 관련 명칭·로고·상표는 각 소유자의 자산이며, 이 프로젝트에서의 언급은 식별·참고 목적일 뿐입니다.
> 본 프로그램은 "있는 그대로(AS IS)" 제공되며, 사용에 따르는 모든 책임은 사용자에게 있습니다.
>
> This project is not affiliated with, endorsed by, or sponsored by Google LLC or YouTube.
> "YouTube", "YouTube Music", and related names, logos, and trademarks are the property of their respective owners; any reference is for identification purposes only.
> This software is provided "AS IS", and you use it at your own risk.
