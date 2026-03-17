import type { CronJobListItem, MessageRecord, ProjectTreeRecord } from "@remote-codex/contracts";

export interface LiveStreamState {
  reasoningText: string;
  assistantText: string;
  planText: string;
}

export type ThreadMessagesMode = "reset" | "prependOlder" | "appendNewer";

export function mergeThreadMessages(
  existing: MessageRecord[],
  incoming: MessageRecord[],
  mode: "prepend" | "append",
): MessageRecord[] {
  const merged = mode === "prepend" ? [...incoming, ...existing] : [...existing, ...incoming];
  const deduped = new Map<number, MessageRecord>();
  merged.forEach((message) => {
    deduped.set(message.id, message);
  });

  return Array.from(deduped.values()).sort((left, right) => left.id - right.id);
}

export function formatDate(value: string | null | undefined): string {
  if (!value) {
    return "-";
  }

  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function formatClockTime(value: string | null | undefined): string {
  if (!value) {
    return "-";
  }

  return new Intl.DateTimeFormat("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

export function formatDurationMs(value: number | null | undefined): string {
  if (!value || value < 1000) {
    return "1초 미만";
  }

  const totalSeconds = Math.round(value / 1000);
  if (totalSeconds < 60) {
    return `${totalSeconds}초`;
  }

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (!seconds) {
    return `${minutes}분`;
  }

  return `${minutes}분 ${seconds}초`;
}

export function formatRelativeTime(value: string | null | undefined): string {
  if (!value) {
    return "방금";
  }

  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) {
    return "-";
  }

  const diffMs = Date.now() - timestamp;
  const absMs = Math.abs(diffMs);
  const minute = 60_000;
  const hour = minute * 60;
  const day = hour * 24;
  const week = day * 7;
  const suffix = diffMs >= 0 ? "전" : "후";

  if (absMs < minute) {
    return diffMs >= 0 ? "방금" : "곧";
  }

  if (absMs < hour) {
    return `${Math.round(absMs / minute)}분 ${suffix}`;
  }

  if (absMs < day) {
    return `${Math.round(absMs / hour)}시간 ${suffix}`;
  }

  if (absMs < week) {
    return `${Math.round(absMs / day)}일 ${suffix}`;
  }

  return formatDate(value);
}

export function formatRelativeTimeCompact(value: string | null | undefined): string {
  if (!value) {
    return "-";
  }

  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) {
    return "-";
  }

  const diffMs = timestamp - Date.now();
  const future = diffMs > 0;
  const absMinutes = Math.round(Math.abs(diffMs) / 60_000);

  if (absMinutes < 1) {
    return future ? "Soon" : "Just now";
  }

  const units = [
    { threshold: 60, size: 1, suffix: "m" },
    { threshold: 24 * 60, size: 60, suffix: "h" },
    { threshold: 7 * 24 * 60, size: 24 * 60, suffix: "d" },
    { threshold: 30 * 24 * 60, size: 7 * 24 * 60, suffix: "w" },
    { threshold: 365 * 24 * 60, size: 30 * 24 * 60, suffix: "mo" },
  ];

  const unit = units.find((entry) => absMinutes < entry.threshold) || {
    size: 365 * 24 * 60,
    suffix: "y",
  };
  const amount = Math.max(1, Math.round(absMinutes / unit.size));
  const compact = `${amount}${unit.suffix}`;

  return future ? `In ${compact}` : `${compact} ago`;
}

export function truncateText(value: string, maxLength = 140): string {
  const normalized = String(value || "").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(0, maxLength - 1))}…`;
}

export function getTreeRootPath(selectedPath: string): string {
  if (!selectedPath) {
    return "/";
  }

  const windowsMatch = selectedPath.match(/^[a-zA-Z]:[\\/]/);
  if (windowsMatch) {
    return windowsMatch[0].replace("/", "\\");
  }

  return "/";
}

export function getPathSegmentsFromRoot(rootPath: string, targetPath: string): string[] {
  if (!targetPath || targetPath === rootPath) {
    return [];
  }

  if (rootPath === "/") {
    return targetPath.split("/").filter(Boolean);
  }

  return targetPath
    .replace(rootPath, "")
    .split(/[\\/]/)
    .filter(Boolean);
}

function compareCronJobs(left: CronJobListItem, right: CronJobListItem): number {
  if (left.running !== right.running) {
    return Number(right.running) - Number(left.running);
  }

  if (left.enabled !== right.enabled) {
    return Number(right.enabled) - Number(left.enabled);
  }

  const leftNextRun = left.nextRunAt ? new Date(left.nextRunAt).getTime() : Number.POSITIVE_INFINITY;
  const rightNextRun = right.nextRunAt ? new Date(right.nextRunAt).getTime() : Number.POSITIVE_INFINITY;
  if (leftNextRun !== rightNextRun) {
    return leftNextRun - rightNextRun;
  }

  return String(left.name || "").localeCompare(String(right.name || ""));
}

export function groupCronJobsByProjectAndThread(
  jobs: CronJobListItem[],
  projects: ProjectTreeRecord[],
  searchValue: string,
) {
  const normalizedSearch = searchValue.trim().toLowerCase();
  const projectMap = new Map<
    number,
    {
      projectId: number;
      projectName: string;
      threads: Map<number, { threadId: number; threadTitle: string; jobs: CronJobListItem[] }>;
    }
  >();

  projects.forEach((project) => {
    projectMap.set(project.id, {
      projectId: project.id,
      projectName: project.name,
      threads: new Map(),
    });
  });

  jobs.forEach((job) => {
    const searchable = [
      job.projectName,
      job.threadTitle,
      job.name,
      job.prompt,
      job.cronExpr,
      job.timezone,
    ]
      .join(" ")
      .toLowerCase();

    if (normalizedSearch && !searchable.includes(normalizedSearch)) {
      return;
    }

    if (!projectMap.has(job.projectId)) {
      projectMap.set(job.projectId, {
        projectId: job.projectId,
        projectName: job.projectName,
        threads: new Map(),
      });
    }

    const projectEntry = projectMap.get(job.projectId)!;
    if (!projectEntry.threads.has(job.threadId)) {
      projectEntry.threads.set(job.threadId, {
        threadId: job.threadId,
        threadTitle: job.threadTitle,
        jobs: [],
      });
    }

    projectEntry.threads.get(job.threadId)!.jobs.push(job);
  });

  return Array.from(projectMap.values())
    .map((project) => ({
      ...project,
      threads: Array.from(project.threads.values())
        .map((thread) => ({
          ...thread,
          jobs: thread.jobs.slice().sort(compareCronJobs),
        }))
        .sort((left, right) => left.threadTitle.localeCompare(right.threadTitle)),
    }))
    .filter((project) => (normalizedSearch ? project.threads.length > 0 : true))
    .sort((left, right) => left.projectName.localeCompare(right.projectName));
}
