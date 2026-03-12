# Remote Codex Monorepo

로컬 `codex` CLI와 Telegram 사용자 계정을 연결해서, 웹에서 Codex project / thread를 관리하는 앱입니다.

현재 저장소 구조:

- `apps/api-server`: Node.js + Express API 서버
- `apps/web`: React + Vite 웹 앱
- `packages/contracts`: API DTO / WebSocket 이벤트 공유 타입

핵심 구조:

- Codex project 1개 = Telegram forum supergroup 1개
- Codex thread 1개 = Telegram topic 1개
- 새 프로젝트 생성 시 forum supergroup을 자동 생성합니다
- 웹에서 보낸 메시지는 로그인한 내 Telegram 계정 이름으로 전송됩니다
- Codex 응답은 Telegram bot이 같은 topic에 전송합니다
- Telegram 사용자 계정 로그인은 `API ID + API Hash + 전화번호 로그인` 방식으로 동작합니다

## 기술 스택

- Node.js
- TypeScript
- Express
- React
- Vite
- SQLite (`better-sqlite3`)
- GramJS (`telegram`)
- 로컬 `codex` CLI
- npm workspaces monorepo

## 설치 방법

사전 준비:

- Node.js 20 이상
- npm
- 로컬에 `codex` CLI 설치 및 로그인 완료
- Telegram 계정
- Telegram API ID / API Hash 발급 완료

설치:

```bash
npm install
cp .env.example .env
cp apps/web/.env.example apps/web/.env
```

## 실행 방법

개발 모드:

```bash
npm run dev
```

`api-server` 는 `http://localhost:3000`, `web` 은 `http://localhost:5173` 에서 실행됩니다.

빌드:

```bash
npm run build
```

프로덕션에서 API 서버만 직접 실행할 때:

```bash
npm run start -w @remote-codex/api-server
```

`web` 은 `apps/web/dist` 결과물을 별도 정적 호스팅으로 배포하면 됩니다.

## 초기 설정 방법

처음 실행하면 Setup 페이지가 열립니다.

입력값:

- Telegram API ID
- Telegram API Hash
- 전화번호
- Telegram bot token

흐름:

1. `로그인 코드 보내기`
2. Telegram 앱으로 받은 로그인 코드 입력
3. 2단계 인증이 켜져 있으면 비밀번호 입력
4. 로그인 완료 후 메인 화면으로 이동
5. `새 프로젝트`에서 그룹 이름과 폴더 경로 입력
6. 앱이 forum supergroup을 자동 생성하고 bot을 자동 초대한 뒤 프로젝트와 연결

## Telegram API 준비 방법

Telegram 사용자 계정으로 메시지를 보내려면 `my.telegram.org` 에서 API 키를 직접 발급받아야 합니다.

1. 브라우저에서 [my.telegram.org](https://my.telegram.org/) 접속
2. Telegram 전화번호로 로그인
3. `API development tools` 선택
4. 앱 생성
5. `api_id` 와 `api_hash` 확인

이 두 값을 Setup 화면에 입력합니다.

## Telegram forum supergroup 준비 방법

이 버전에서는 사용자가 supergroup을 미리 만들 필요가 없습니다.

새 프로젝트 생성 시 아래 두 값만 입력하면 됩니다.

- 그룹 이름
- 로컬 폴더 경로

그러면 앱이:

1. Telegram forum supergroup 생성
2. 생성된 supergroup에 bot 자동 초대
3. 생성된 supergroup을 프로젝트에 연결
4. 이후 새 thread 생성 시 Telegram topic 자동 생성

## 로그인 / 권한 요구사항

필수 조건:

- 로그인한 Telegram 사용자 계정이 정상이어야 함
- `api_id`, `api_hash` 가 유효해야 함
- 전화번호 로그인 코드 확인 가능해야 함
- 2단계 인증 사용 중이면 비밀번호를 알아야 함

이 버전은 bot admin 권한이나 topic 관리 권한이 필요 없습니다.  
대신 supergroup을 생성하는 Telegram 사용자 계정 자체가 작업 주체입니다.

## 주요 기능

- 초기 설정이 없으면 Setup 페이지 표시
- Telegram 사용자 계정 로그인
- 새 프로젝트 생성 시 forum supergroup 자동 생성
- project 생성 시 입력값 최소화
  - 그룹 이름
  - 로컬 폴더 경로
- 좌측 프로젝트 / 스레드 트리
- 스레드 10개 단위 목록 + 더보기
- 좌측 대메뉴
  - `Chat`
  - `Cron Job`
  - `Config`
- WebSocket 기반 실시간 반영
  - 채팅 메시지
  - project 생성 / 수정 / 삭제
  - thread 생성 / 수정 / 삭제
- 클라이언트 라우터
  - `/setup`
  - `/chat/projects/new`
  - `/chat/projects/:projectId`
  - `/chat/projects/:projectId/threads/:threadId`
  - `/cron-jobs`
  - `/config`
- Config 페이지
  - 응답 language 지침 저장
  - 기본 model 저장
  - 기본 `model_reasoning_effort` 저장
- Telegram bot 명령어
  - `/model`
  - `/model_reasoning_effort`
  - `/plan {message}`
  - `/model`, `/model_reasoning_effort` 는 inline keyboard 선택 지원
- 새 thread 생성 시 Telegram topic 자동 생성 및 매핑
- project 삭제
  - 로컬 DB의 project / thread / message 기록 삭제
  - Telegram supergroup 자체는 유지
- 웹 메시지 입력 시:
  - Telegram topic에 내 계정으로 사용자 메시지 전송
  - 같은 thread의 Codex 세션 실행 / 재사용
  - Codex 응답을 같은 topic에 bot으로 전송
  - Codex가 생성한 스크린샷/이미지 아티팩트가 있으면 같은 답장 체인으로 Telegram에 첨부 전송
- SQLite 로컬 저장

## 현재 동작 범위

현재 구현된 메시지 흐름:

- Web UI -> Telegram topic -> Codex -> Telegram topic
- Telegram topic -> Codex -> Telegram topic

아직 구현하지 않은 것:

- 기존 Telegram 그룹에 다시 연결하는 UI

## Codex 준비 방법

이 프로젝트는 OpenAI API를 직접 호출하지 않고, 로컬 `codex app-server` 런타임을 사용합니다.

필수 준비:

1. `npm install` 로 프로젝트 의존성 설치
2. `@openai/codex` `0.113.0+` 사용
3. Codex Desktop 또는 CLI 로그인 완료
4. 프로젝트 폴더가 실제로 존재해야 함

확인 예시:

```bash
npm install
./node_modules/.bin/codex --version
./node_modules/.bin/codex login
```

실행 엔진:

- long-lived `codex app-server`
- thread마다 runtime thread id 저장 및 재사용
- `/plan {message}` 는 app-server collaboration mode `plan` 으로 1회 실행

## 데이터 저장 구조

SQLite에 아래 테이블을 사용합니다.

- `global_settings`
- `projects`
- `project_telegram_connections`
- `threads`
- `messages`

추가 저장 항목:

- Telegram 사용자 세션 문자열
- Telegram 사용자 ID / 이름 / 전화번호
- project별 channel id / access hash
- thread별 Codex runtime thread id
- thread별 model / reasoning effort override
- message별 Telegram message id

## 환경 변수

`.env.example`

```env
PORT=3000
DATABASE_PATH=./data/app.db
AUTO_OPEN_BROWSER=false
CODEX_BIN=codex
CODEX_SANDBOX=workspace-write
CODEX_APPROVAL=never
CODEX_TIMEOUT_MS=600000
# CODEX_MODEL=gpt-5.4
# CODEX_SEARCH=false
```

설명:

- `PORT`: 웹 서버 포트
- `DATABASE_PATH`: SQLite 파일 경로
- `AUTO_OPEN_BROWSER`: 실행 시 브라우저 자동 열기 여부
- `CODEX_BIN`: `codex` 실행 경로
- `CODEX_SANDBOX`: Codex sandbox 모드
- `CODEX_APPROVAL`: Codex approval 정책
- `CODEX_TIMEOUT_MS`: 한 턴 최대 실행 시간

## 트러블슈팅

### 1. 로그인 코드를 받지 못함

- 전화번호 형식을 국제번호로 입력했는지 확인하세요. 예: `+821012345678`
- Telegram 앱에서 로그인 코드가 왔는지 확인하세요.
- `api_id`, `api_hash` 가 맞는지 다시 확인하세요.

### 2. 2단계 인증 오류

- Telegram 계정에 2FA가 켜져 있으면 비밀번호를 추가로 입력해야 합니다.
- 비밀번호를 모르면 Telegram 앱에서 먼저 확인해야 합니다.

### 3. 새 프로젝트 생성이 실패함

- Telegram 사용자 로그인 상태인지 확인하세요.
- 그룹 이름이 너무 짧거나 Telegram 정책에 맞지 않는지 확인하세요.
- 같은 이름으로 여러 번 빠르게 만들다가 제한에 걸릴 수 있습니다.

### 4. 웹에서 메시지를 보냈는데 Codex 응답이 실패함

- `codex` 가 설치되어 있는지 확인하세요.
- `codex login` 이 되어 있는지 확인하세요.
- 프로젝트 폴더 경로가 실제 디렉토리인지 확인하세요.

### 5. 웹에서 보낸 메시지가 Telegram에서 내 이름으로 보이지 않음

- Setup이 Telegram 사용자 로그인 방식으로 완료됐는지 확인하세요.
- 로그인이 풀렸으면 다시 로그인해야 합니다.
