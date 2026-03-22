import type {
  ComposerModelOption,
  RelayAuthSession,
  RelayDeviceSummary,
  TurnSummaryPayload,
  UserInputRequestPayload,
} from "@remote-codex/contracts";

import type { StoredAuth } from "./auth";
import type {
  WorkspaceAttachmentPreview,
  WorkspaceProject,
  WorkspaceThread,
  WorkspaceThreadMessage,
  WorkspaceThreadSnapshot,
} from "../types";

export const isPreviewMode = false;
export const previewInitialDeviceId = null;
export const previewInitialProjectId = null;
export const previewInitialThreadId = null;

export const previewStoredAuth: StoredAuth = {
  idToken: "preview-id-token",
  accessToken: "preview-access-token",
  tokenType: "bearer",
};

export const previewSession: RelayAuthSession = {
  user: {
    id: "preview-user",
    email: "nahooni0511@gmail.com",
  },
  expiresAt: null,
};

export const previewDevices: RelayDeviceSummary[] = [
  {
    deviceId: "preview-device-mbp",
    displayName: "MacBook Pro M3",
    ownerEmail: "nahooni0511@gmail.com",
    appVersion: "relay",
    protocolVersion: "2.4.0",
    minSupportedProtocol: "2.4.0",
    devicePublicKey: null,
    connected: true,
    lastSeenAt: new Date().toISOString(),
    snapshotUpdatedAt: new Date().toISOString(),
    blockedReason: null,
  },
  {
    deviceId: "preview-device-ubuntu",
    displayName: "Ubuntu-Edge-01",
    ownerEmail: "nahooni0511@gmail.com",
    appVersion: "core",
    protocolVersion: "2.3.9",
    minSupportedProtocol: "2.3.9",
    devicePublicKey: null,
    connected: true,
    lastSeenAt: new Date().toISOString(),
    snapshotUpdatedAt: new Date().toISOString(),
    blockedReason: null,
  },
  {
    deviceId: "preview-device-ipad",
    displayName: "iPad Pro Relay",
    ownerEmail: "nahooni0511@gmail.com",
    appVersion: "legacy",
    protocolVersion: "2.1.0",
    minSupportedProtocol: "2.1.0",
    devicePublicKey: null,
    connected: false,
    lastSeenAt: new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString(),
    snapshotUpdatedAt: new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString(),
    blockedReason: null,
  },
];

export type PreviewWorkspace = {
  device: RelayDeviceSummary;
  projects: WorkspaceProject[];
  modelOptions: ComposerModelOption[];
  threadSnapshotsById: Record<number, WorkspaceThreadSnapshot>;
  attachmentPreviewsByMessageId: Record<number, WorkspaceAttachmentPreview>;
};

const previewModelOptions: ComposerModelOption[] = [
  {
    value: "gpt-5.4",
    label: "GPT-5.4",
    defaultReasoningEffort: "medium",
    supportedReasoningEfforts: ["low", "medium", "high", "xhigh"],
  },
  {
    value: "gpt-5.4-mini",
    label: "GPT-5.4 Mini",
    defaultReasoningEffort: "medium",
    supportedReasoningEfforts: ["low", "medium", "high"],
  },
];

const previewThreads = [
  "Main Refactoring: API Layer",
  "API Integration Issues",
  "Gateway Heartbeat Monitoring",
  "Relay Buffer Initialization",
  "Schema Validation Overhaul",
  "Worker Node Auth Tokens",
  "Kubernetes Ingress Optimization",
  "Legacy Bridge Documentation",
  "Telemetry Drain Calibration",
  "Incident #441 Post-Mortem",
];

function createThread(threadId: number, projectId: number, title: string, overrides: Partial<WorkspaceThread> = {}): WorkspaceThread {
  const now = new Date().toISOString();

  return {
    id: threadId,
    projectId,
    title,
    codexThreadId: `thread-${threadId}`,
    codexModelOverride: null,
    codexReasoningEffortOverride: null,
    defaultMode: "default",
    codexPermissionMode: "default",
    origin: "local-ui",
    status: "active",
    createdAt: now,
    updatedAt: now,
    telegramBinding: null,
    effectiveModel: "gpt-5.4",
    effectiveReasoningEffort: "medium",
    running: false,
    queueDepth: 0,
    currentMode: "default",
    composerSettings: {
      defaultMode: "default",
      modelOverride: null,
      reasoningEffortOverride: null,
      permissionMode: "default",
    },
    ...overrides,
  };
}

const macProjects: WorkspaceProject[] = [
  {
    id: 101,
    name: "Project Alpha",
    folderPath: "/home/user/relay/neural-mesh-alpha",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    telegramBinding: null,
    threads: previewThreads.map((title, index) => createThread(1001 + index, 101, title)),
  },
  {
    id: 102,
    name: "Codex Internal",
    folderPath: "/home/user/vault/codex-core",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    telegramBinding: null,
    threads: [
      createThread(1101, 102, "Release Notes Draft"),
      createThread(1102, 102, "Infrastructure Audit"),
    ],
  },
];

const ubuntuProjects: WorkspaceProject[] = [
  {
    id: 201,
    name: "Edge Gateway",
    folderPath: "/srv/edge/gateway",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    telegramBinding: null,
    threads: [
      createThread(2101, 201, "Certificate Rotation"),
      createThread(2102, 201, "Ingress Policy Cleanup"),
    ],
  },
];

const summaryPayload: TurnSummaryPayload = {
  turnRunId: 3902,
  durationMs: 93_000,
  changedFileCount: 3,
  changedFiles: [
    {
      path: "apps/relay-mobile/src/screens/WorkspaceScreen.tsx",
      status: "M",
      insertions: 182,
      deletions: 41,
      isUntracked: false,
      statsExact: true,
    },
    {
      path: "apps/relay-mobile/src/components/RichText.tsx",
      status: "??",
      insertions: 214,
      deletions: 0,
      isUntracked: true,
      statsExact: true,
    },
    {
      path: "packages/client-core/src/rich-text.ts",
      status: "M",
      insertions: 96,
      deletions: 11,
      isUntracked: false,
      statsExact: true,
    },
  ],
  exploredFilesCount: 12,
  undoAvailable: true,
  undoState: "available",
  branch: "codex/mobile-chat-parity",
  repoCleanAtStart: false,
  note: "웹 패널 기준으로 assistant/system 메시지 레이아웃을 재구성했습니다.",
};

const userInputRequest: UserInputRequestPayload = {
  requestId: "preview-request-1",
  turnId: "turn-preview-1",
  itemId: "item-preview-1",
  status: "pending",
  submittedAnswers: null,
  questions: [
    {
      id: "permission_mode",
      header: "권한",
      question: "이번 작업에 어떤 접근 권한을 줄까요?",
      options: [
        { label: "기본권한", description: "파일 읽기와 안전한 명령 위주로 진행합니다." },
        { label: "전체 액세스", description: "파일 수정과 더 넓은 명령 실행을 허용합니다." },
      ],
      isOther: false,
      isSecret: false,
    },
  ],
};

const previewImageDataUri =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAASwAAADICAIAAADdvUsCAAABN0lEQVR4nO3TMQEAIAzAMMC/5+GiPEgU9Lpn5gBA9mYgWbMQLVmIFmzEC1ZiBaszAtWYgWrMQLVmIFmzEC1ZiBaszAtWYgWrMQLVmIFmzEC1ZiBaszAtWYgWrMQLVmIFmzEC1ZiBaszAtWYgWrMQLVmIFmzEC1ZiBaszAtWYgWrMQLVmIFmzEC1ZiBaszAtWYgWrMQLVmIFmzEC1ZiBaszAtWYgWrMQLVmIFmzEC1ZiBaszAtWYgWrMQLVmIFmzEC1ZiBaszAtWYgWrMQLVmIFmzEC1ZiBaszAtWYgWrMQLVmIFmzEC1ZiBaszAtWYgWrMQLVmIFmzEC1ZiBaszAtWYgWrMQLVmIFmzEC1ZiBaszAtWYgWrMQLVmIFm7AEs4QO7V7u9xgAAAABJRU5ErkJggg==";

function createMessage(
  id: number,
  threadId: number,
  kind: WorkspaceThreadMessage["kind"],
  role: string,
  content: string,
  overrides: Partial<WorkspaceThreadMessage> = {},
): WorkspaceThreadMessage {
  const createdAt = new Date(Date.now() - (20 - id) * 60_000).toISOString();

  return {
    id,
    threadId,
    kind,
    role,
    content,
    originChannel: "local-ui",
    originActor: role === "user" ? "nahooni0511@gmail.com" : role === "assistant" ? "Codex" : null,
    displayHints: {
      hideOrigin: false,
      accent:
        kind === "progress_event" ? "progress" : kind === "cron_event" ? "cron" : kind === "error_event" ? "error" : "default",
      localSenderName: role === "assistant" ? "Codex" : role === "user" ? "nahooni0511@gmail.com" : null,
      telegramSenderName: null,
    },
    errorText: kind === "error_event" ? content : null,
    attachmentKind: null,
    attachmentMimeType: null,
    attachmentFilename: null,
    payload: null,
    createdAt,
    ...overrides,
  };
}

const previewMessagesByThread: Record<number, WorkspaceThreadSnapshot> = {
  1001: {
    thread: macProjects[0].threads[0],
    hasMoreBefore: true,
    liveStream: null,
    messages: [
      createMessage(
        1,
        1001,
        "progress_event",
        "system",
        "Codex가 현재 `relay-mobile` 채팅 뷰를 웹 패널 기준으로 재정렬하는 중입니다.",
      ),
      createMessage(
        2,
        1001,
        "user_message",
        "user",
        "웹 버전처럼 정리해줘.\n\n- assistant/system은 말풍선 없이\n- user만 말풍선 유지\n- 본문은 **선택 가능** 해야 해",
      ),
      createMessage(
        3,
        1001,
        "assistant_message",
        "assistant",
        "# 변경 방향\nassistant/system/progress/error 메시지는 중앙 정렬 본문형으로 바꿉니다.\n\n> 웹 채팅 패널과 같은 밀도와 위계를 유지합니다.\n\n## 포함 사항\n- [x] 회색 시스템 텍스트\n- [x] 흰색 Codex 본문\n- [x] `inline code`\n- [x] fenced code block\n- [x] [링크 열기](https://remote-codex.com)\n\n```ts\nconst layout = {\n  maxWidth: 900,\n  align: \"center\",\n};\n```",
      ),
      createMessage(4, 1001, "cron_event", "system", "매일 오전 9시에 워크스페이스 점검 자동화가 예약되어 있습니다."),
      createMessage(
        5,
        1001,
        "assistant_message",
        "assistant",
        "요약 카드와 선택 요청 카드도 모바일에서 바로 읽히도록 유지합니다.",
        {
          payload: {
            kind: "attachments",
            attachments: [
              {
                id: "preview-attachment-1",
                name: "WorkspaceScreen.tsx",
                path: "/Users/nahooni0511/workspace/remote-codex/apps/relay-mobile/src/screens/WorkspaceScreen.tsx",
                relativePath: "apps/relay-mobile/src/screens/WorkspaceScreen.tsx",
                source: "project-file",
                mimeType: "text/plain",
              },
            ],
          },
        },
      ),
      createMessage(6, 1001, "artifact_event", "assistant", "디자인 참고용 첨부 이미지를 포함했습니다.", {
        attachmentKind: "image",
        attachmentMimeType: "image/png",
        attachmentFilename: "chat-preview.png",
      }),
      createMessage(7, 1001, "turn_summary_event", "assistant", "", {
        payload: {
          kind: "turn_summary",
          summary: summaryPayload,
        },
      }),
      createMessage(8, 1001, "system_message", "assistant", "", {
        payload: {
          kind: "user_input_request",
          request: userInputRequest,
        },
      }),
      createMessage(9, 1001, "error_event", "system", "Bridge 연결이 잠깐 끊겨 재시도 대기 중입니다."),
    ],
  },
  1002: {
    thread: macProjects[0].threads[1],
    hasMoreBefore: false,
    liveStream: {
      reasoningText: "로그 재생성 경로와 토큰 갱신 경로를 비교하고 있습니다.",
      assistantText: "",
      planText: "- [in_progress] API 타임아웃 원인 확인\n- [pending] 재연결 전략 정리",
    },
    messages: [
      createMessage(10, 1002, "user_message", "user", "현재 API 장애 조건만 정리해줘."),
      createMessage(11, 1002, "assistant_message", "assistant", "우선 인증 토큰 갱신 실패와 relay websocket close 이벤트를 분리해서 봐야 합니다."),
    ],
  },
  1101: {
    thread: macProjects[1].threads[0],
    hasMoreBefore: false,
    liveStream: null,
    messages: [
      createMessage(12, 1101, "system_message", "system", "릴리스 노트 초안 작성 스레드입니다."),
      createMessage(13, 1101, "assistant_message", "assistant", "SDK 55 네이티브 dev build 이슈와 채팅 뷰 재구성을 반영했습니다."),
    ],
  },
  2101: {
    thread: ubuntuProjects[0].threads[0],
    hasMoreBefore: false,
    liveStream: null,
    messages: [
      createMessage(14, 2101, "system_message", "system", "Gateway 인증서 회전 작업이 대기 중입니다."),
      createMessage(15, 2101, "assistant_message", "assistant", "만료 임박 인증서부터 교체 순서를 제안했습니다."),
    ],
  },
};

function buildThreadSnapshotMap(projects: WorkspaceProject[]) {
  return projects.flatMap((project) => project.threads).reduce<Record<number, WorkspaceThreadSnapshot>>((map, thread) => {
    map[thread.id] =
      previewMessagesByThread[thread.id] || {
        thread,
        hasMoreBefore: false,
        liveStream: null,
        messages: [
          createMessage(thread.id, thread.id, "system_message", "system", `${thread.title} 스레드의 샘플 대화입니다.`),
          createMessage(thread.id + 1, thread.id, "assistant_message", "assistant", "디자인 검증용 preview 데이터로 렌더링되었습니다."),
        ],
      };
    return map;
  }, {});
}

export const previewWorkspaceByDeviceId: Record<string, PreviewWorkspace> = {
  "preview-device-mbp": {
    device: previewDevices[0],
    projects: macProjects,
    modelOptions: previewModelOptions,
    threadSnapshotsById: buildThreadSnapshotMap(macProjects),
    attachmentPreviewsByMessageId: {
      6: {
        kind: "image",
        fileName: "chat-preview.png",
        contentType: "image/png",
        uri: previewImageDataUri,
      },
    },
  },
  "preview-device-ubuntu": {
    device: previewDevices[1],
    projects: ubuntuProjects,
    modelOptions: previewModelOptions,
    threadSnapshotsById: buildThreadSnapshotMap(ubuntuProjects),
    attachmentPreviewsByMessageId: {},
  },
};
