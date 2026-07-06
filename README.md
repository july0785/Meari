# 메아리 (Meari)

지금 유튜브 뮤직에서 듣고 있는 노래를 **디스코드 프로필에 자동으로 띄워 주는** 작은 데스크톱 앱입니다.

창 하나에 `music.youtube.com` 을 그대로 띄우고, 재생 중인 곡의 제목·가수·앨범 이미지·진행 상태를 읽어
**디스코드 Rich Presence** 로 보여 줍니다. 브라우저 확장이나 별도 프로그램 없이, 앱 하나로 끝납니다.

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

**[Releases](https://github.com/july0785/Meari/releases)** 에서 내려받습니다. 실행 파일은 필요한 런타임(Chromium·ffmpeg 등)을 전부 포함하고 있어 별도 설치가 필요 없습니다. (요구 사양: Windows 10 이상 64비트)

| 파일 | 방식 |
|------|------|
| `Meari-…-setup.exe` | 설치 버전 |
| `Meari-…-portable.exe` | 포터블 — 더블클릭 (실행 시 임시폴더에 압축 해제) |
| `Meari-…-win-x64.zip` | **압축 해제형** — 풀어서 `메아리.exe` 실행. 포터블이 안 될 때 이걸 쓰세요 |

**실행이 안 될 때:**
1. **SmartScreen 경고** → "추가 정보 → 실행" (서명이 없어 뜨는 정상 경고)
2. **포터블이 반응 없음** → 백신·보안정책이 임시폴더 실행을 차단하는 경우입니다. **zip 판**을 받아 풀고 `메아리.exe` 를 직접 실행하거나, 설치 버전을 쓰세요
3. 디스코드 표시가 안 뜰 뿐 앱은 뜨는 경우 → 디스코드 데스크톱 앱이 켜져 있는지, 설정 → 활동 개인정보에서 활동 표시가 켜져 있는지 확인

### 백신(V3·Windows Defender 등) 차단 대처

메아리는 **코드 서명이 없는 오픈소스 앱**이라 일부 백신이 오탐(false positive)으로 차단할 수 있습니다. 악성 동작은 하지 않습니다 — 앱은 외부 프로세스를 실행하지 않으며, 하는 일은 유튜브 뮤직 창 표시와 디스코드 연동뿐입니다. 전체 코드는 이 저장소에서 확인할 수 있습니다.

차단 시 대처(권장 순):

1. **zip 판 사용** — 자기추출을 하지 않아 오탐이 가장 적습니다. 풀어서 `메아리.exe` 실행.
2. **예외(허용) 등록**
   - V3: 환경설정 → 정밀검사/실시간검사 → 검사 제외 → 메아리 폴더/파일 추가
   - Windows 보안: 바이러스 및 위협 방지 → 설정 관리 → 제외 항목 추가
3. **오진 신고** — 저작권자(배포자)가 실행 파일을 백신사에 오진 신고하면 화이트리스트로 등록됩니다.
   - 안랩(V3): [오진 신고](https://www.ahnlab.com/kr/site/download/twreport/twReportView.do)
   - Microsoft: [파일 제출](https://www.microsoft.com/en-us/wdsi/filesubmission)
4. **직접 빌드** — 소스에서 직접 빌드하면 바이너리를 스스로 통제할 수 있습니다 ([빌드](#빌드) 참고).

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
| `disableGpu` | `false` | 화면이 깜빡이는 환경에서만 `true`. GPU 가속을 꺼서 안정성을 얻는 대신 CPU 사용량이 크게 늘어납니다. |
| `rawTitle` | `false` | `true` 면 제목 정리(태그·병기·번역 꼬리 제거)를 끄고 유튜브 원제목 그대로 표시합니다. |
| `videoCover` | `"mix"` | 영상(16:9) 썸네일 처리. `"mix"` = 자동(분위기 태그 일치 → 풍경, 글씨 있는 썸네일 → 풍경, 글씨 없으면 스마트 크롭 — 글씨 유무는 윈도우 내장 문자인식으로 판별), `"scenery"` = 풍경만, `"crop"` = 크롭만. 풍경 사진은 저장소 `scenery/` 폴더에서 관리합니다. |

예시:

```json
{
  "pollIntervalMs": 3000,
  "discordClientId": "여기에_본인_애플리케이션_ID"
}
```

---

## 디스코드 표시

빌드본에 애플리케이션 ID가 들어 있어 따로 설정할 게 없습니다. 디스코드 데스크톱 앱을 켠 채로 메아리를 실행하고
음악을 재생하면, 프로필에 "듣는 중" · 곡 제목 · 가수 · 앨범 이미지 · 진행 바가 표시됩니다.
(앨범 이미지는 유튜브 뮤직의 공개 이미지 주소를 그대로 사용합니다.)

> **포크해서 쓰는 경우에만** 본인 디스코드 애플리케이션 ID가 필요합니다.
> `src/main/constants.ts` 의 `DISCORD_CLIENT_ID` 를 바꾸거나, `config.json` 의 `discordClientId` 또는 환경변수 `DISCORD_CLIENT_ID` 로 덮어쓰면 됩니다.
> (ID 발급: <https://discord.com/developers/applications> → New Application → Application ID 복사. 봇·토큰 불필요.)

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

**예외 — 사진 재배포 금지:** `scenery/` 폴더의 사진들은 MIT 라이선스 적용 대상이 아니며, **재배포가 금지됩니다.**
사진의 모든 권리는 각 저작권 보유자에게 있고, 복제·수정·재배포·상업적 이용을 허용하지 않습니다.
포크 시 해당 폴더의 사진은 삭제하거나 본인의 이미지로 교체해 주세요. (자세한 내용: [scenery/README.md](scenery/README.md))

---

## 고지

> 본 프로그램은 구글(Google LLC) 및 유튜브와 아무런 제휴·승인·후원 관계가 없는 독립적인 비공식 도구입니다.
> "YouTube", "YouTube Music" 및 관련 명칭·로고·상표는 각 소유자의 자산이며, 이 프로젝트에서의 언급은 식별·참고 목적일 뿐입니다.
> 본 프로그램은 "있는 그대로(AS IS)" 제공되며, 사용에 따르는 모든 책임은 사용자에게 있습니다.
>
> This project is not affiliated with, endorsed by, or sponsored by Google LLC or YouTube.
> "YouTube", "YouTube Music", and related names, logos, and trademarks are the property of their respective owners; any reference is for identification purposes only.
> This software is provided "AS IS", and you use it at your own risk.
