import { NavLink } from "react-router-dom";

import { Icon } from "../ui/Icon";
import styles from "./WorkspaceFrame.module.css";

type Section = "chat" | "cron" | "config";

const entries: Array<{ key: Section; label: string; href: string; icon: "chat" | "play" | "settings" }> = [
  { key: "chat", label: "Chat", href: "/chat", icon: "chat" },
  { key: "cron", label: "Cron", href: "/cron-jobs", icon: "play" },
  { key: "config", label: "Config", href: "/config", icon: "settings" },
];

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
  return (
    <main className={[styles.shell, !sidebar ? styles.shellNoSidebar : ""].filter(Boolean).join(" ")}>
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
              className={({ isActive }) =>
                [styles.navLink, isActive || section === entry.key ? styles.navLinkActive : ""].filter(Boolean).join(" ")
              }
            >
              <Icon name={entry.icon} />
              <span>{entry.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className={styles.userCard}>
          <span className={styles.userLabel}>Connected</span>
          <strong>{userName || "User"}</strong>
        </div>
      </aside>
      {sidebar ? (
        <>
          <aside
            className={[styles.sidebar, sidebarOpen === false ? styles.sidebarHidden : ""].filter(Boolean).join(" ")}
          >
            {sidebar}
          </aside>
          {sidebarOpen ? <button type="button" className={styles.backdrop} onClick={onSidebarClose} /> : null}
        </>
      ) : null}
      <section className={styles.content}>{children}</section>
    </main>
  );
}
