import { NavLink, useNavigate } from "react-router-dom";

import { cx } from "../../lib/classNames";
import { isPlainLeftClick, navigateWithTransition } from "../../lib/navigation";
import { getChatPath, getConfigPath, getCronJobsPath } from "../../lib/routes";
import { useWorkspaceRailSlot } from "../../app/WorkspaceChrome";
import { Icon } from "../ui/Icon";
import styles from "./WorkspaceFrame.module.css";

type Section = "chat" | "cron" | "config";

export function WorkspaceFrame({
  section,
  userName,
  sidebar,
  sidebarOpen,
  onSidebarClose,
  children,
}: {
  section: Section;
  userName: string;
  sidebar?: React.ReactNode;
  sidebarOpen?: boolean;
  onSidebarClose?: () => void;
  children: React.ReactNode;
}) {
  const navigate = useNavigate();
  const railSlot = useWorkspaceRailSlot();
  const entries: Array<{ key: Section; label: string; href: string; icon: "chat" | "play" | "settings" }> = [
    { key: "chat", label: "Chat", href: getChatPath(), icon: "chat" },
    { key: "cron", label: "Cron", href: getCronJobsPath(), icon: "play" },
    { key: "config", label: "Config", href: getConfigPath(), icon: "settings" },
  ];

  return (
    <main className={cx(styles.shell, !sidebar && styles.shellNoSidebar)}>
      <aside className={styles.rail}>
        <div className={styles.brand}>
          <span className={styles.brandMark}>
            <Icon name="terminal" />
          </span>
          <span className={styles.brandText}>Remote Codex</span>
        </div>
        <nav className={styles.nav}>
          {entries.map((entry) => (
            <NavLink
              key={entry.key}
              to={entry.href}
              onClick={(event) => {
                if (!isPlainLeftClick(event)) {
                  return;
                }
                event.preventDefault();
                navigateWithTransition(navigate, entry.href);
              }}
              className={({ isActive }) => cx(styles.navLink, (isActive || section === entry.key) && styles.navLinkActive)}
            >
              <Icon name={entry.icon} />
              <span>{entry.label}</span>
            </NavLink>
          ))}
          {railSlot ? <div className={styles.navExtra}>{railSlot}</div> : null}
        </nav>
        <div className={styles.userCard}>
          <span className={styles.userLabel}>Connected</span>
          <strong>{userName}</strong>
        </div>
      </aside>
      {sidebar ? (
        <>
          <aside className={cx(styles.sidebar, sidebarOpen === false && styles.sidebarHidden)}>
            {sidebar}
          </aside>
          {sidebarOpen ? <button type="button" className={styles.backdrop} onClick={onSidebarClose} /> : null}
        </>
      ) : null}
      <section className={styles.content}>{children}</section>
    </main>
  );
}
