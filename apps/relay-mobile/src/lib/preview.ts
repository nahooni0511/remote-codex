import type { RelayAuthSession, RelayDeviceSummary } from "@remote-codex/contracts";

import type { StoredAuth } from "./auth";
import type { WorkspaceProject, WorkspaceThreadMessage } from "../types";

export const isPreviewMode = process.env.EXPO_PUBLIC_RELAY_PREVIEW === "1";
export const previewInitialDeviceId = process.env.EXPO_PUBLIC_RELAY_PREVIEW_DEVICE_ID || null;
export const previewInitialProjectId = process.env.EXPO_PUBLIC_RELAY_PREVIEW_PROJECT_ID
  ? Number(process.env.EXPO_PUBLIC_RELAY_PREVIEW_PROJECT_ID)
  : null;
export const previewInitialThreadId = process.env.EXPO_PUBLIC_RELAY_PREVIEW_THREAD_ID
  ? Number(process.env.EXPO_PUBLIC_RELAY_PREVIEW_THREAD_ID)
  : null;

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
  messagesByThread: Record<number, WorkspaceThreadMessage[]>;
};

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

const macProjects: WorkspaceProject[] = [
  {
    id: 101,
    name: "Project Alpha",
    folderPath: "/home/user/relay/neural-mesh-alpha",
    threads: previewThreads.map((title, index) => ({ id: 1001 + index, title })),
  },
  {
    id: 102,
    name: "Codex Internal",
    folderPath: "/home/user/vault/codex-core",
    threads: [
      { id: 1101, title: "Release Notes Draft" },
      { id: 1102, title: "Infrastructure Audit" },
    ],
  },
  {
    id: 103,
    name: "Relay Node 09",
    folderPath: "/opt/dev/relay/nodes/rn-09-stable",
    threads: [
      { id: 1201, title: "Sync Pipeline Retry Logic" },
      { id: 1202, title: "Telemetry Ingestion Baseline" },
    ],
  },
  {
    id: 104,
    name: "Shadow Mesh",
    folderPath: "/home/user/research/p2p-shadow-mesh",
    threads: [
      { id: 1301, title: "Peer Discovery Improvements" },
      { id: 1302, title: "Mesh Health Snapshot" },
    ],
  },
  {
    id: 105,
    name: "Mainframe Sync",
    folderPath: "/srv/backup/synchro-main",
    threads: [
      { id: 1401, title: "Cold Storage Mirroring" },
      { id: 1402, title: "Snapshot Verification" },
    ],
  },
];

const ubuntuProjects: WorkspaceProject[] = [
  {
    id: 201,
    name: "Edge Gateway",
    folderPath: "/srv/edge/gateway",
    threads: [
      { id: 2101, title: "Certificate Rotation" },
      { id: 2102, title: "Ingress Policy Cleanup" },
    ],
  },
  {
    id: 202,
    name: "Telemetry Mirror",
    folderPath: "/srv/edge/telemetry",
    threads: [
      { id: 2201, title: "Drain Protection Rules" },
      { id: 2202, title: "Fallback Buffering" },
    ],
  },
];

const previewMessagesByThread: Record<number, WorkspaceThreadMessage[]> = {
  1001: [
    { id: 1, role: "system", content: "Codex 작업 요약" },
    {
      id: 2,
      role: "user",
      content: "API 계층 리팩터링 범위를 정리하고, relay-mobile 적용 전 체크리스트를 만들어줘.",
    },
    {
      id: 3,
      role: "assistant",
      content:
        "우선 연결 흐름을 device -> project -> thread -> chat로 분리하고, 각 단계에서 선택 상태를 명확히 저장하는 게 좋습니다. 그 다음 devices 화면은 피그마와 동일한 카드 레이아웃으로 정리하면 됩니다.",
    },
  ],
  1002: [
    { id: 4, role: "system", content: "지난 API 장애 기록을 바탕으로 재현 조건을 수집 중입니다." },
    { id: 5, role: "assistant", content: "인증 토큰 갱신 실패와 relay session 재연결 조건을 우선 분리해서 보겠습니다." },
  ],
  2101: [
    { id: 6, role: "system", content: "Gateway 인증서 회전 작업이 대기 중입니다." },
    { id: 7, role: "assistant", content: "만료 임박 인증서부터 교체 순서를 제안했습니다." },
  ],
};

function buildMessageMap(projects: WorkspaceProject[]) {
  return projects.flatMap((project) => project.threads).reduce<Record<number, WorkspaceThreadMessage[]>>((map, thread) => {
    map[thread.id] = previewMessagesByThread[thread.id] || [
      { id: thread.id, role: "system", content: `${thread.title} 스레드의 샘플 대화입니다.` },
      { id: thread.id + 1, role: "assistant", content: "디자인 검증용 preview 데이터로 렌더링되었습니다." },
    ];
    return map;
  }, {});
}

export const previewWorkspaceByDeviceId: Record<string, PreviewWorkspace> = {
  "preview-device-mbp": {
    device: previewDevices[0],
    projects: macProjects,
    messagesByThread: buildMessageMap(macProjects),
  },
  "preview-device-ubuntu": {
    device: previewDevices[1],
    projects: ubuntuProjects,
    messagesByThread: buildMessageMap(ubuntuProjects),
  },
};
