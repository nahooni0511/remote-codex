import styles from "./Banner.module.css";

type Tone = "error" | "success" | "info";

export function Banner({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return <div className={[styles.banner, styles[tone]].join(" ")}>{children}</div>;
}
