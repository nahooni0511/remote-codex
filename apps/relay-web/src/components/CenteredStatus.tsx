type CenteredStatusProps = {
  title: string;
  description?: string | null;
  tone?: "default" | "error";
};

export function CenteredStatus({ title, description, tone = "default" }: CenteredStatusProps) {
  return (
    <main className="page page--centered">
      <section className="card hero--narrow">
        <h1>{title}</h1>
        {description ? <p className={tone === "error" ? "errorText" : undefined}>{description}</p> : null}
      </section>
    </main>
  );
}
