# Codex Telegram Thread Manager

Codex project / thread를 웹 UI에서 관리하고, 각 thread를 Telegram forum supergroup topic과 1:1로 연결하는 로컬 웹 앱입니다.  
Telegram topic에서 메시지가 들어오면 앱이 해당 project 폴더에서 실제 `codex` CLI를 실행하고, 응답을 다시 같은 Telegram topic으로 보내도록 구성했습니다.

핵심 규칙:

- Codex project 1개 = Telegram supergroup 1개
- Codex thread 1개 = Telegram topic 1개
- Telegram 그룹은 앱이 자동 생성하지 않습니다
- 사용자가 미리 만든 forum supergroup을 연결합니다
- Telegram Bot API만 사용합니다
- TDLib, MTProto, OpenClaw 연동은 포함하지 않습니다

## 기술 스택

- Node.js
- TypeScript
- Express
- SQLite (`better-sqlite3`)
- Telegram Bot API
- 실제 로컬 `codex` CLI
- 정적 브라우저 UI (HTML/CSS/Vanilla JS)

## 현재 동작 요약

1. Setup 페이지에서 앱 이름, bot token, 첫 project 로컬 폴더를 입력합니다.
   - 로컬 폴더 경로는 서버 파일시스템 트리 팝업에서 선택할 수 있습니다.
   - Telegram supergroup은 화면 가이드를 따라 준비한 뒤 Hello World 탐색기로 찾습니다.
2. 앱이 bot의 그룹 참가 / admin / `Manage Topics` / forum supergroup 여부를 검증합니다.
3. 서버가 Telegram `getUpdates` polling을 시작합니다.
4. topic별 메시지를 project/thread에 매핑합니다.
5. 같은 thread는 항상 같은 Telegram topic과 같은 Codex session으로 이어집니다.
6. Telegram에서 사람이 메시지를 보내면:
   - 로컬 DB에 저장
   - 해당 project 폴더에서 `codex exec` 또는 `codex exec resume` 실행
   - Codex 응답을 DB에 저장
   - 같은 Telegram topic에 응답 전송
7. 웹 UI에서 메시지를 보내도:
   - Telegram topic에 웹 입력을 미러링
   - 같은 Codex thread에 전달
   - Codex 응답을 Telegram topic으로 다시 전송

## 설치 방법

사전 요구사항:

- Node.js 20 이상
- npm
- 로컬에 `codex` CLI 설치 및 로그인 완료
- 미리 생성된 Telegram forum supergroup
- 해당 그룹에 초대한 Telegram bot

설치:

```bash
npm install
cp .env.example .env
```

## 실행 방법

개발 모드:

```bash
npm run dev
```

프로덕션 빌드:

```bash
npm run build
npm start
```

기본 포트는 `3000`입니다. 실행 후 브라우저에서 `http://localhost:3000` UI가 열립니다.

## 초기 설정 방법

앱을 처음 실행하면 Setup 페이지가 먼저 뜹니다.

입력값:

- 앱 이름
- Telegram bot token
- 첫 번째 Codex project의 절대 경로

project 이름은 별도로 입력하지 않습니다. 검증된 Telegram supergroup 제목을 자동으로 사용합니다.
`첫 번째 Codex project의 절대 경로`는 폴더 트리 팝업에서 선택할 수 있습니다.
Telegram supergroup은 수동 입력 대신 Setup 화면의 준비 가이드와 Hello World 탐색으로 선택합니다.

Setup 완료 시 서버는 아래를 즉시 검증합니다.

- bot token 유효성
- bot이 해당 그룹에 들어가 있는지
- 그룹이 forum supergroup인지
- bot이 admin인지
- bot이 `Manage Topics` 권한을 갖고 있는지

검증이 모두 통과하면:

- global settings 저장
- 첫 번째 project 저장
- project와 Telegram supergroup 연결 저장
- Telegram polling 시작

## Codex 준비 방법

이 프로젝트는 OpenAI API를 직접 호출하지 않고, 로컬에 설치된 `codex` CLI를 실행합니다.

필수 준비:

1. `codex` CLI가 PATH에 있어야 합니다.
2. `codex login`이 완료되어 있어야 합니다.
3. 각 project의 로컬 폴더 경로가 실제로 존재해야 합니다.

확인 예시:

```bash
which codex
codex --help
codex login
```

기본 실행 방식:

- 새 대화 시작: `codex exec`
- 같은 thread 이어서 실행: `codex exec resume <session-id>`
- 기본 sandbox: `workspace-write`
- 기본 approval: `never`

즉 Telegram topic 하나가 Codex session 하나에 대응합니다.

## Telegram bot 준비 방법

1. Telegram에서 `@BotFather`를 열고 새 bot을 생성합니다.
2. 발급된 bot token을 복사합니다.
3. bot을 연결하려는 Telegram supergroup에 초대합니다.
4. bot을 그룹 관리자(admin)로 승격합니다.
5. 관리자 권한 중 `Manage Topics`를 반드시 켭니다.

## Telegram forum supergroup 준비 방법

1. Telegram에서 supergroup을 직접 만듭니다.
2. 그룹 설정에서 Topics / Forum 기능을 켭니다.
3. bot을 그룹에 초대합니다.
4. bot을 admin으로 지정하고 `Manage Topics`를 활성화합니다.
5. 앱 Setup 또는 Project 상세에서 `탐색 시작`을 누릅니다.
6. 원하는 그룹 또는 topic에 정확히 `Hello World`를 보냅니다.
7. 앱에서 `이 그룹 사용`을 누른 뒤 `연결 검증`을 실행합니다.

### chat ID를 직접 확인해야 할 때

- 공개 supergroup이면 `@groupusername`을 사용할 수 있습니다.
- 비공개 supergroup이면 보통 `-100...` 형태 chat ID가 필요합니다.
- Bot API `getUpdates` 응답에서 아래처럼 확인할 수 있습니다.

```json
"chat": {
  "id": -1003837985829,
  "title": "Homie",
  "is_forum": true,
  "type": "supergroup"
}
```

여기서 넣어야 할 값은 `-1003837985829`입니다.

### Hello World로 chat ID 찾기

앱에서 직접 찾는 방법:

1. Setup 또는 Project 상세에서 `Hello World로 그룹 찾기`의 `탐색 시작` 버튼을 누릅니다.
2. 원하는 Telegram supergroup 또는 topic에 정확히 `Hello World`를 보냅니다.
3. 앱이 heartbeat 방식으로 Bot API update를 확인합니다.
4. 발견된 채팅방 목록에서 `이 그룹 사용` 버튼을 누르면 연결 대상 chat ID를 저장합니다.
5. 이어서 `연결 검증` 버튼을 누르면 forum/admin/topic 권한을 확인합니다.
6. project 이름은 그룹 제목으로 자동 사용됩니다.

## bot admin / topic 권한 요구사항

필수 조건:

- bot이 그룹 멤버여야 함
- 그룹이 supergroup + forum enabled 상태여야 함
- bot이 admin이어야 함
- bot이 `Manage Topics` 권한을 가져야 함

이 조건이 맞아야:

- project 연결 검증 성공
- 새 thread 생성 시 Telegram topic 생성 성공
- Telegram topic 메시지를 Codex로 정상 전달 가능

## 주요 기능

- 초기 설정이 없으면 Setup 페이지 표시
- project 생성 / 수정
- project 이름 입력 제거
- Telegram supergroup 제목을 project 이름으로 자동 사용
- 로컬 폴더 경로 트리 팝업 브라우저
- Hello World 기반 Telegram supergroup chat ID 탐색
- Setup / project 상세에서 Telegram 준비 가이드 + 탐색 + 연결 검증
- 좌측 트리에서 project / thread 탐색
- 새 thread 생성 시 Telegram forum topic 생성 및 저장
- Telegram topic 메시지 polling
- 삭제된 Telegram topic으로 전송을 시도하면 연결된 local thread 자동 삭제
- topic별 Codex session 생성 및 재사용
- Telegram -> Codex -> Telegram 왕복
- 웹 UI -> Codex -> Telegram 왕복
- SQLite 기반 로컬 저장

## 데이터 저장 구조

SQLite에 아래 핵심 테이블을 생성합니다.

- `global_settings`
- `projects`
- `project_telegram_connections`
- `threads`
- `messages`

추가 저장 항목:

- `threads.codex_session_id`
- `threads.telegram_topic_name`
- `threads.origin`
- `messages.telegram_message_id`
- `messages.source`
- `messages.sender_name`
- `messages.sender_telegram_user_id`
- `messages.error_text`

기본 DB 파일 경로는 `.env`의 `DATABASE_PATH` 값이며 기본값은 `./data/app.db`입니다.

## 환경 변수

`.env.example`:

```env
PORT=3000
DATABASE_PATH=./data/app.db
AUTO_OPEN_BROWSER=true
TELEGRAM_POLL_INTERVAL_MS=3000
CODEX_BIN=codex
CODEX_SANDBOX=workspace-write
CODEX_APPROVAL=never
CODEX_TIMEOUT_MS=600000
# CODEX_MODEL=gpt-5.4
# CODEX_SEARCH=false
```

설명:

- `TELEGRAM_POLL_INTERVAL_MS`: Telegram polling 주기
- `CODEX_BIN`: 실행할 `codex` 바이너리 경로
- `CODEX_SANDBOX`: Codex sandbox 모드
- `CODEX_APPROVAL`: Codex approval 정책
- `CODEX_TIMEOUT_MS`: Codex 한 턴 최대 실행 시간
- `CODEX_MODEL`: 필요 시 Codex 모델 지정
- `CODEX_SEARCH`: `true`이면 Codex web search 활성화

## 프로젝트 구조

```text
.
├── public/
│   ├── app.js
│   ├── index.html
│   └── styles.css
├── src/
│   ├── codex.ts
│   ├── db.ts
│   ├── server.ts
│   └── telegram.ts
├── .env.example
├── .gitignore
├── package.json
├── README.md
└── tsconfig.json
```

## 보안 / 운영 주의사항

이 앱은 Telegram 메시지를 받아 로컬 `codex` CLI에 넘기고, project 폴더 안에서 실제 작업을 수행할 수 있습니다.  
즉 bot이 들어간 Telegram topic에 사실상 로컬 작업 권한이 연결되는 구조입니다.

권장 사항:

- 공개 그룹에 두지 말 것
- 신뢰된 사용자만 있는 private forum supergroup에서만 사용할 것
- project 폴더 권한 범위를 최소화할 것
- 필요한 경우 `CODEX_SANDBOX` 값을 더 보수적으로 조정할 것

## 트러블슈팅

### 1. `Project folder path must be an absolute path`

- project 경로는 반드시 절대 경로여야 합니다.
- 예: `/Users/yourname/workspace/my-project`

### 2. `Project folder path does not exist`

- 입력한 로컬 폴더가 실제로 존재하는지 확인하세요.
- 파일 경로가 아니라 디렉토리 경로여야 합니다.

### 3. `Telegram API request failed` 또는 `chat not found`

- bot token이 맞는지 확인하세요.
- bot이 해당 그룹에 실제로 들어가 있는지 확인하세요.
- 비공개 그룹인데 `@username`을 넣었다면 numeric chat ID(`-100...`)를 사용하세요.

### 4. `Telegram group is not configured as a forum supergroup`

- Telegram 그룹 설정에서 Topics / Forum 기능이 켜져 있어야 합니다.
- `getUpdates`에서 해당 chat이 `"type": "supergroup"` 이고 `"is_forum": true` 인지 확인하세요.

### 5. `Bot must be an administrator in the Telegram group`

- bot을 그룹 관리자(admin)로 지정해야 합니다.

### 6. `Bot must have the Manage Topics admin right`

- 관리자 권한 중 `Manage Topics`를 직접 켜야 합니다.

### 7. `codex` 명령이 실패함

- `which codex`로 경로를 확인하세요.
- `codex login`이 완료되어 있는지 확인하세요.
- 필요하면 `.env`의 `CODEX_BIN`에 절대 경로를 넣으세요.

### 8. Telegram에서는 메시지가 보이는데 Codex 응답이 안 옴

- 서버가 실행 중인지 확인하세요.
- polling이 켜져 있는지 UI 상단 상태를 확인하세요.
- bot이 topic 메시지를 볼 수 있는 그룹인지 확인하세요.
- topic 메시지가 bot 자신의 메시지인지 확인하세요. bot이 보낸 메시지는 다시 Codex로 전달하지 않습니다.

### 9. 오래된 topic 메시지까지 한꺼번에 처리됨

- 이 앱은 Telegram `getUpdates` offset을 로컬 SQLite에 저장합니다.
- 필요하면 DB의 `global_settings`에서 `telegram_last_update_id`를 조정하거나 DB를 초기화하세요.

### 10. 응답이 너무 길어서 Telegram 전송이 실패하거나 잘림

- 현재 구현은 Telegram 전송 길이를 자동으로 잘라서 보냅니다.
- 긴 코드 변경 설명은 웹 UI에서 전체 이력을 확인하세요.

### 11. `Conflict: terminated by other getUpdates request`

- 같은 bot token을 다른 프로세스나 다른 서버가 이미 `getUpdates`로 읽고 있는 상태입니다.
- 동시에 하나의 polling 소비자만 유지하세요.
- 기존 테스트 스크립트, 다른 로컬 서버, 다른 bridge 앱, webhook 소비자가 있으면 먼저 정리해야 합니다.

### 12. Telegram에서 topic을 삭제했는데 thread가 즉시 안 사라짐

- Bot API에는 topic 삭제 전용 update가 없어, 이 앱은 삭제된 topic으로 다시 전송을 시도하는 시점에 thread를 자동 정리합니다.
- 즉 topic 삭제 직후가 아니라, 다음 웹 메시지 전송이나 Codex 응답 전송 시점에 local thread가 사라질 수 있습니다.

## 향후 확장 아이디어

- Telegram webhook 모드
- topic 제목 변경 동기화
- Codex 실행 로그 상세 뷰
- thread archive / close 상태
- 파일 diff 미리보기
- 사용자별 접근 제어
