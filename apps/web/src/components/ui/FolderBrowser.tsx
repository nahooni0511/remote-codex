import { useEffect, useState } from "react";

import { apiFetch } from "../../lib/api/client";
import { getPathSegmentsFromRoot, getTreeRootPath } from "../../lib/chat";
import { Banner } from "./Banner";
import { Button } from "./Button";
import styles from "./FolderBrowser.module.css";

type FsNode = {
  name: string;
  path: string;
  hasChildren: boolean;
};

function FolderNode({
  entry,
  depth,
  expandSegments,
  onSelect,
}: {
  entry: FsNode;
  depth: number;
  expandSegments: string[];
  onSelect: (path: string) => void;
}) {
  const [expanded, setExpanded] = useState(depth === 0 || expandSegments.length > 0);
  const [loading, setLoading] = useState(false);
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
              onSelect={onSelect}
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
            <p>디렉토리를 클릭하면 선택됩니다.</p>
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
            onSelect={(path) => {
              onSelect(path);
              onClose();
            }}
          />
        </ul>
      </div>
    </div>
  );
}
