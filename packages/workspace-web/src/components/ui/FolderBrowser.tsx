import { useEffect, useState } from "react";

import { apiFetch } from "../../lib/api/client";
import { getPathSegmentsFromRoot, getTreeRootPath } from "../../lib/chat";
import { Banner } from "./Banner";
import { Button } from "./Button";
import { Icon } from "./Icon";
import styles from "./FolderBrowser.module.css";

type FsNode = {
  name: string;
  path: string;
  hasChildren: boolean;
};

type CreateDirectoryResponse = {
  entry: FsNode;
};

function FolderNode({
  entry,
  depth,
  expandSegments,
  selectedPath,
  onSelect,
  onCreateAndSelect,
}: {
  entry: FsNode;
  depth: number;
  expandSegments: string[];
  selectedPath: string;
  onSelect: (path: string) => void;
  onCreateAndSelect: (path: string) => void;
}) {
  const [expanded, setExpanded] = useState(depth === 0 || expandSegments.length > 0);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [children, setChildren] = useState<FsNode[] | null>(null);

  useEffect(() => {
    if (!expanded || !entry.hasChildren || children !== null) {
      return;
    }

    let mounted = true;
    setLoading(true);
    void apiFetch<{ entries: FsNode[] }>(`/api/fs/list?path=${encodeURIComponent(entry.path)}`)
      .then((result) => {
        if (!mounted) {
          return;
        }
        setChildren(result.entries || []);
        setError(null);
      })
      .catch((reason: Error) => {
        if (!mounted) {
          return;
        }
        setError(reason.message);
      })
      .finally(() => {
        if (mounted) {
          setLoading(false);
        }
      });

    return () => {
      mounted = false;
    };
  }, [children, entry.hasChildren, entry.path, expanded]);

  const handleCreateFolder = () => {
    const parentLabel = depth === 0 ? entry.path : entry.name || entry.path;
    const name = window.prompt(`"${parentLabel}" 아래에 만들 새 폴더 이름을 입력하세요.`);
    if (!name?.trim()) {
      return;
    }

    setCreating(true);
    setError(null);
    setExpanded(true);
    void apiFetch<CreateDirectoryResponse>("/api/fs/directories", {
      method: "POST",
      body: JSON.stringify({
        parentPath: entry.path,
        name,
      }),
    })
      .then((result) => {
        onCreateAndSelect(result.entry.path);
      })
      .catch((reason: Error) => {
        setError(reason.message);
      })
      .finally(() => {
        setCreating(false);
      });
  };

  return (
    <li className={styles.node}>
      <div className={styles.nodeRow} style={{ paddingLeft: `${depth * 0.75}rem` }}>
        <button
          type="button"
          className={styles.toggle}
          disabled={!entry.hasChildren}
          onClick={() => setExpanded((current) => !current)}
        >
          {entry.hasChildren ? (expanded ? "▾" : "▸") : "·"}
        </button>
        <button type="button" className={styles.select} onClick={() => onSelect(entry.path)}>
          {depth === 0 ? entry.path : entry.name || entry.path}
        </button>
        <div className={styles.nodeActions}>
          {selectedPath === entry.path ? <span className={styles.selectedBadge}>선택됨</span> : null}
          <button
            type="button"
            className={styles.createButton}
            onClick={handleCreateFolder}
            disabled={creating}
            aria-label={`${depth === 0 ? entry.path : entry.name || entry.path} 아래에 새 폴더 만들기`}
            title="새 폴더 만들기"
          >
            <Icon name="plus" />
          </button>
        </div>
      </div>
      {expanded ? (
        <ul className={styles.children}>
          {loading ? <li className={styles.dimmed}>불러오는 중...</li> : null}
          {error ? <li><Banner tone="error">{error}</Banner></li> : null}
          {!loading && !error && children?.length === 0 ? <li className={styles.dimmed}>비어 있음</li> : null}
          {children?.map((child) => (
            <FolderNode
              key={child.path}
              entry={child}
              depth={depth + 1}
              expandSegments={expandSegments[0] === child.name ? expandSegments.slice(1) : []}
              selectedPath={selectedPath}
              onSelect={onSelect}
              onCreateAndSelect={onCreateAndSelect}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

export function FolderBrowser({
  open,
  selectedPath,
  onClose,
  onSelect,
}: {
  open: boolean;
  selectedPath: string;
  onClose: () => void;
  onSelect: (path: string) => void;
}) {
  if (!open) {
    return null;
  }

  const rootPath = getTreeRootPath(selectedPath);
  const expandSegments = getPathSegmentsFromRoot(rootPath, selectedPath);

  return (
    <div className={styles.overlay}>
      <div className={styles.backdrop} onClick={onClose} />
      <div className={styles.card}>
        <div className={styles.header}>
          <div>
            <h3>서버 폴더 트리</h3>
            <p>디렉토리를 클릭하면 선택되고, 우측 + 버튼으로 하위 폴더를 바로 만들 수 있습니다.</p>
          </div>
          <Button type="button" variant="ghost" onClick={onClose}>
            닫기
          </Button>
        </div>
        <ul className={styles.tree}>
          <FolderNode
            entry={{ name: rootPath, path: rootPath, hasChildren: true }}
            depth={0}
            expandSegments={expandSegments}
            selectedPath={selectedPath}
            onSelect={(path) => {
              onSelect(path);
              onClose();
            }}
            onCreateAndSelect={(path) => {
              onSelect(path);
              onClose();
            }}
          />
        </ul>
      </div>
    </div>
  );
}
