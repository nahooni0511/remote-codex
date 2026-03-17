import type { ProjectFileNode, ProjectFileTreeResponse } from "@remote-codex/contracts";
import { useEffect, useMemo, useState } from "react";

import { apiFetch } from "../../lib/api/client";
import { Banner } from "./Banner";
import { Button } from "./Button";
import { Icon } from "./Icon";
import styles from "./ProjectFilePicker.module.css";

function formatLocation(rootPath: string, currentPath: string): string {
  if (rootPath === currentPath) {
    return ".";
  }

  return currentPath.startsWith(rootPath) ? currentPath.slice(rootPath.length + 1) || "." : currentPath;
}

function getParentPath(rootPath: string, currentPath: string): string {
  if (rootPath === currentPath) {
    return rootPath;
  }

  const segments = currentPath.split(/[\\/]/).filter(Boolean);
  const rootSegments = rootPath.split(/[\\/]/).filter(Boolean);
  const nextSegments = segments.slice(0, -1);

  if (nextSegments.length <= rootSegments.length) {
    return rootPath;
  }

  const separator = currentPath.includes("\\") ? "\\" : "/";
  if (/^[a-zA-Z]:[\\/]/.test(rootPath)) {
    return `${rootPath}${separator}${nextSegments.slice(rootSegments.length).join(separator)}`;
  }

  return `${separator}${nextSegments.join(separator)}`;
}

export function ProjectFilePicker({
  open,
  projectId,
  initialPath,
  onClose,
  onSelect,
}: {
  open: boolean;
  projectId: number;
  initialPath?: string | null;
  onClose: () => void;
  onSelect: (file: ProjectFileNode) => void;
}) {
  const [tree, setTree] = useState<ProjectFileTreeResponse | null>(null);
  const [currentPath, setCurrentPath] = useState<string | null>(initialPath || null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    setCurrentPath(initialPath || null);
  }, [initialPath, open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    let cancelled = false;
    const pathQuery = currentPath ? `?path=${encodeURIComponent(currentPath)}` : "";
    setLoading(true);
    void apiFetch<ProjectFileTreeResponse>(`/api/projects/${projectId}/files/tree${pathQuery}`)
      .then((payload) => {
        if (cancelled) {
          return;
        }
        setTree(payload);
        setError(null);
      })
      .catch((reason: Error) => {
        if (cancelled) {
          return;
        }
        setError(reason.message);
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [currentPath, open, projectId]);

  const canGoUp = Boolean(tree && tree.currentPath !== tree.rootPath);
  const currentLabel = useMemo(() => {
    if (!tree) {
      return ".";
    }
    return formatLocation(tree.rootPath, tree.currentPath);
  }, [tree]);

  if (!open) {
    return null;
  }

  return (
    <div className={styles.overlay}>
      <div className={styles.backdrop} onClick={onClose} />
      <div className={styles.card}>
        <div className={styles.header}>
          <div>
            <h3>첨부파일 선택</h3>
            <p>project 루트 안의 파일만 선택할 수 있습니다.</p>
          </div>
          <Button type="button" variant="ghost" onClick={onClose}>
            닫기
          </Button>
        </div>

        <div className={styles.toolbar}>
          <Button
            type="button"
            variant="secondary"
            onClick={() => tree && setCurrentPath(tree.rootPath)}
            disabled={!tree || tree.currentPath === tree.rootPath}
          >
            루트
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              if (!tree || !canGoUp) {
                return;
              }
              setCurrentPath(getParentPath(tree.rootPath, tree.currentPath));
            }}
            disabled={!canGoUp}
          >
            상위로
          </Button>
          <div className={styles.location}>{currentLabel}</div>
        </div>

        {error ? <Banner tone="error">{error}</Banner> : null}

        <div className={styles.list}>
          {loading ? <div className={styles.empty}>불러오는 중...</div> : null}
          {!loading && !tree?.entries.length ? <div className={styles.empty}>선택 가능한 파일이 없습니다.</div> : null}
          {!loading
            ? tree?.entries.map((entry) => (
                <button
                  key={entry.path}
                  type="button"
                  className={styles.item}
                  onClick={() => {
                    if (entry.kind === "directory") {
                      setCurrentPath(entry.path);
                      return;
                    }
                    onSelect(entry);
                    onClose();
                  }}
                >
                  <span className={styles.itemIcon}>
                    <Icon name={entry.kind === "directory" ? "folder" : "attachment"} />
                  </span>
                  <span className={styles.itemText}>
                    <strong>{entry.name}</strong>
                    <span>{entry.relativePath}</span>
                  </span>
                  {entry.kind === "directory" ? <span className={styles.itemMeta}>열기</span> : <span className={styles.itemMeta}>선택</span>}
                </button>
              ))
            : null}
        </div>
      </div>
    </div>
  );
}
