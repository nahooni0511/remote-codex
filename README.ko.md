[Read in English](README.md)

# Remote Codex

Remote Codex는 Codex가 설치된 PC에 웹으로 접속해 Codex를 제어하는 web-first runtime입니다. Telegram 연동을 지원하고 있고, 모바일 앱도 같은 방향으로 설계되어 있지만 현재 기준 README는 웹 사용 흐름을 중심으로 설명합니다.

> 현재 기준으로 가장 안정적으로 설명할 수 있는 사용 경로는 local web + hosted relay web입니다.

## 개요

Remote Codex는 두 평면으로 동작합니다.

- `local runtime`: Codex가 설치된 PC에서 실행되는 런타임이며, 로컬 웹 UI, Telegram 연동, relay bridge를 포함합니다.
- `hosted relay`: 외부에서 로그인한 사용자가 자신의 장치를 찾고 연결할 수 있게 해 주는 control plane입니다.
- `local web`: 같은 PC 또는 로컬 네트워크에서 직접 접속하는 UI입니다.
- `remote web`: `remote-codex.com`에서 로그인한 뒤 relay를 통해 원격 장치에 접속하는 UI입니다.

즉, 평소에는 로컬 웹으로 직접 쓰고, 외부에서는 hosted relay를 통해 같은 workspace에 들어가는 구조입니다.

## 빠른 시작

이 섹션은 monorepo 개발 실행이 아니라 publishable package 설치 경로를 기준으로 작성되었습니다.

### 요구사항

- Node.js 20 이상
- npm
- local machine에서 Codex 로그인 완료
- Telegram 기능을 사용할 경우 Telegram 계정, `api_id`, `api_hash`, bot token

### 설치

```bash
npm install -g @everyground/remote-codex
```

### 실행

```bash
remote-codex
```

브라우저에서 다음 주소를 엽니다.

- `http://localhost:3000`

### 기본 저장 위치

- `~/.remote-codex`

### 자주 쓰는 환경변수

| Variable | 설명 |
| --- | --- |
| `REMOTE_CODEX_DATA_DIR` | 런타임 데이터 디렉터리 변경 |
| `REMOTE_CODEX_PORT` | local HTTP 포트 변경 |
| `REMOTE_CODEX_HOST` | local bind host 변경 |
| `REMOTE_CODEX_PACKAGE_NAME` | update check 대상 패키지명 변경 |
| `REMOTE_CODEX_NPM_REGISTRY` | update check에 사용할 npm registry 변경 |

패키지 자체 설명은 [packages/remote-codex/README.md](packages/remote-codex/README.md)에서도 확인할 수 있습니다.

## 웹 사용 흐름

현재 Remote Codex 문서는 웹 사용 흐름을 기준으로 설명합니다.

### 로컬 웹

로컬 런타임을 실행한 뒤 `http://localhost:3000`에 접속하면 다음 화면을 중심으로 사용합니다.

- `Chat`: project와 thread를 열고 Codex와 직접 대화하는 화면
- `Config`: 모델 설정, 앱 업데이트, relay pairing을 관리하는 화면
- `Setup`: Telegram 계정과 bot 연동을 설정하는 화면

기본 사용 순서는 다음과 같습니다.

1. `remote-codex` 실행
2. `http://localhost:3000` 열기
3. 필요하면 `Setup`에서 Telegram 연동
4. `Chat`에서 project와 thread를 열고 Codex 사용
5. 외부 접속이 필요하면 `Config`에서 relay pairing 진행

### 원격 웹

Hosted relay 기준 원격 사용 흐름은 다음과 같습니다.

1. `https://remote-codex.com`에서 로그인
2. `devices` 화면에서 pairing code 발급
3. 로컬 장치의 `Config` 화면에서 pairing code와 relay server URL 입력
4. pairing 완료 후 remote web에서 장치를 선택
5. relay를 통해 같은 workspace에 진입

이 README는 hosted relay 흐름만 다루며, self-hosted relay 구축 가이드는 포함하지 않습니다.

## Telegram 연동

Telegram 연동은 선택 기능입니다. 연결하지 않아도 local web과 relay web은 사용할 수 있습니다.

연동 개요는 다음과 같습니다.

1. [`my.telegram.org`](https://my.telegram.org)에서 `api_id`와 `api_hash`를 발급
2. local web의 `Setup` 화면에서 `API ID`, `API Hash`, 전화번호, bot token 입력
3. Telegram으로 전송된 로그인 코드 입력
4. 계정에 2FA가 켜져 있다면 비밀번호를 추가로 입력

주의할 점:

- Telegram user login과 bot token은 서로 다른 정보입니다.
- 인증 실패 시에는 `Setup` 화면에서 값이 정확한지 먼저 확인하는 것이 좋습니다.
- Telegram을 연결하면 project/thread 흐름을 Telegram 채널과 토픽과 함께 사용할 수 있습니다.

참고 링크:

- [`my.telegram.org`](https://my.telegram.org)
- [Telegram API credentials guide](https://core.telegram.org/api/obtaining_api_id)

## Relay 연동

Relay pairing은 하나의 local device를 hosted remote access plane에 연결하는 절차입니다.

Hosted relay를 사용하는 기본 절차는 다음과 같습니다.

1. `https://remote-codex.com` 로그인
2. `devices` 화면에서 pairing code 생성
3. local web의 `Config` 화면으로 이동
4. `Pairing Code`와 `Relay Server URL` 입력
5. 장치가 relay에 등록되면 remote web에서 선택 가능

기본 hosted relay 주소:

- `https://relay.remote-codex.com`

로컬 테스트 예시:

- `http://localhost:3100`

URL 규칙:

- hosted relay는 `HTTPS`만 허용합니다.
- 로컬 개발 환경에서만 localhost HTTP를 허용합니다.
- relay server URL에 path를 붙여도 저장 시 origin 기준으로 정리됩니다.

## 보안

이 섹션은 현재 구현 기준 보안 모델을 설명합니다. 마케팅 문구가 아니라 실제 동작 기준입니다.

### 무엇을 보호하는가

- remote web 사용자는 먼저 인증된 relay web 세션이 있어야 합니다.
- 장치를 선택하면 짧은 수명의 `connect token`이 발급됩니다.
  - 현재 구현 기준 TTL은 `5분`입니다.
- pairing을 위해 발급되는 `pairing code`도 짧은 수명의 1회성 코드입니다.
  - 현재 구현 기준 TTL은 `10분`입니다.
- relay를 통과하는 workspace 요청과 응답 payload는 `nacl-box` 기반 암호화 envelope로 전송됩니다.
- 장치 측 `device secret`과 `device public/secret key pair`가 장치 인증과 암호화 세션에 사용됩니다.

즉, relay는 “누가 어떤 장치에 붙을 수 있는지”를 관리하지만, 실제 workspace HTTP/realtime payload는 암호화된 상태로 전달됩니다.

### relay가 알 수 있는 것

relay는 완전한 zero-knowledge 서비스가 아닙니다.

relay가 볼 수 있는 정보는 다음과 같습니다.

- 어떤 계정이 어떤 장치를 소유하는지
- 어떤 장치가 online/offline인지
- pairing code와 connect token 같은 control-plane 메타데이터
- 장치 식별자, owner label/email, protocol/app version 같은 운영 정보

반대로 relay가 보호 대상으로 다루는 것은 다음입니다.

- 실제 workspace 요청 본문
- 실제 workspace 응답 본문
- realtime event payload의 평문 내용

따라서 보안 모델은 다음처럼 이해하는 것이 맞습니다.

- relay 운영자는 control plane과 메타데이터를 어느 정도 신뢰해야 합니다.
- 실제 workspace traffic은 암호화된 payload로 중계됩니다.
- 그래서 “완전 무지식 relay”라고 표현하는 것은 부정확합니다.

## 현재 지원 범위

- web 사용 흐름은 local web과 hosted relay web을 기준으로 설명 가능합니다.
- Telegram 연동은 동작 경로가 있고, local runtime에 포함되어 있습니다.
- relay pairing과 원격 웹 진입 흐름도 현재 기준으로 설명 가능합니다.
- 모바일 앱은 repo에 포함되어 있지만 아직 README의 주 사용 경로로 안내할 정도로 완성된 상태는 아닙니다.

## 문제 해결

### 로컬 웹이 열리지 않을 때

- `remote-codex` 프로세스가 실제로 실행 중인지 확인합니다.
- `http://localhost:3000`에 접속하고 있는지 확인합니다.
- 포트를 바꿨다면 `REMOTE_CODEX_PORT` 설정을 확인합니다.

### Telegram 인증이 실패할 때

- `api_id`, `api_hash`, 전화번호, bot token이 맞는지 확인합니다.
- 로그인 코드가 Telegram 공식 앱으로 도착했는지 확인합니다.
- 2FA가 켜진 계정이면 비밀번호 단계가 추가로 필요할 수 있습니다.

### relay pairing이 안 될 때

- pairing code가 만료되지 않았는지 확인합니다.
- relay server URL이 `https://relay.remote-codex.com` 또는 localhost 개발 주소인지 확인합니다.
- 기존 pairing이 남아 있다면 `Config`에서 `Unpair` 후 다시 시도합니다.

### `redirect_mismatch`가 발생할 때

- hosted 서비스 사용 중이라면 공식 로그인 진입점을 다시 엽니다.
- monorepo 로컬 개발 중이라면 relay web은 `http://localhost:5173` 기준 callback 설정을 사용하므로, `127.0.0.1`이나 다른 포트로 열면 실패할 수 있습니다.

## 개발자용 메모

이 섹션은 packaged install 사용자가 아니라 monorepo 개발자를 위한 메모입니다.

### Monorepo Commands

```bash
npm install
npm run dev
npm run dev:local
npm run dev:relay
npm run build
npm run test
```

### Local Dev Endpoints

- local agent: `http://localhost:3000`
- local web dev: `http://localhost:4173`
- relay API dev: `http://localhost:3100`
- relay web dev: `http://localhost:5173`

추가 참고 자료:

- 패키지 런타임 안내: [packages/remote-codex/README.md](packages/remote-codex/README.md)
- beta readiness 체크리스트: [docs/public-beta-checklist.md](docs/public-beta-checklist.md)
