type CenteredStatusProps = {
  title: string;
  description?: string | null;
  tone?: "default" | "error";
};

export function CenteredStatus({ title, description, tone = "default" }: CenteredStatusProps) {
  return (
    <main className="relayPage relayStudioPage relayPageCentered">
      <section className="relayCard relayHeroNarrow">
        <h1>{title}</h1>
        {description ? <p className={tone === "error" ? "relayErrorText" : undefined}>{description}</p> : null}
      </section>
    </main>
  );
}
