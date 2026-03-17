import styles from "./EmptyState.module.css";

export function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className={styles.emptyState}>
      <h2>{title}</h2>
      <p>{description}</p>
    </div>
  );
}
