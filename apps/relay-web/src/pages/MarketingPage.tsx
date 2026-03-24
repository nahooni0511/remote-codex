import type { RelayAuthSession } from "@remote-codex/contracts";
import { Link } from "react-router-dom";

import { MarketingFooter, MarketingTopNav } from "../components/MarketingChrome";
import { MARKETING_DOCS_URL } from "../lib/marketing";
import { getStudioEntryPath } from "../lib/routes";

const controlHighlights = [
  {
    title: "Zero-Trust Auth",
    description: "Biometric mobile confirmation for every remote execution.",
    accent: "marketingAccentLine",
  },
  {
    title: "Low Latency",
    description: "Optimized UDP protocol for real-time terminal feedback.",
    accent: "marketingAccentLine marketingAccentLineAlt",
  },
] as const;

const runtimeBadges = ["NODE_V3", "PY_ENGINE", "GO_RUNTIME", "RUST_CLI"];

export function MarketingPage({ session }: { session: RelayAuthSession }) {
  const installCommand = `curl -fsSL ${window.location.origin}/install.sh | bash`;
  const studioEntryPath = getStudioEntryPath(Boolean(session.user));

  return (
    <main className="marketingPage">
      <MarketingTopNav activePage="landing" session={session} />

      <section className="marketingSection marketingHero">
        <div className="marketingSectionFrame marketingHeroGrid">
          <div className="marketingHeroCopy">
            <span className="marketingHeroBadge">v2.4.0 Engine Live</span>
            <h1 className="marketingHeroTitle">
              The Orchestrated <span>Terminal.</span>
            </h1>
            <p className="marketingHeroLead">
              Control your codex from anywhere. A high-fidelity, command-center aesthetic for modern remote automation
              and unified execution.
            </p>
            <div className="marketingHeroActions">
              <Link className="marketingPrimaryButton" to={studioEntryPath}>
                Go to Studio
              </Link>
              <a className="marketingSecondaryButton" href={MARKETING_DOCS_URL} rel="noreferrer" target="_blank">
                Read Documentation
              </a>
            </div>
          </div>

          <div className="marketingHeroVisual">
            <div className="marketingTerminalCard">
              <div className="marketingTerminalTop">
                <div className="marketingTerminalDots">
                  <span />
                  <span />
                  <span />
                </div>
                <span className="marketingTerminalFile">quick_install.sh</span>
              </div>
              <div className="marketingTerminalBody">
                <div className="marketingTerminalRow">
                  <span>1</span>
                  <code>{installCommand}</code>
                </div>
                <div className="marketingTerminalRow">
                  <span>2</span>
                  <code># codex engine initialized</code>
                </div>
                <div className="marketingTerminalRow">
                  <span>3</span>
                  <code># listening on port 5173</code>
                </div>
              </div>
            </div>

            <div className="marketingPeerCard">
              <div className="marketingPeerTitle">
                <span className="marketingPeerGlyph" />
                <strong>REMOTE PEER</strong>
              </div>
              <div className="marketingPeerProgress">
                <span />
              </div>
              <p>Syncing local codex to remote studio...</p>
            </div>
          </div>
        </div>
      </section>

      <section className="marketingBand" id="features">
        <div className="marketingSectionFrame marketingControlGrid">
          <div className="marketingDeviceStage" aria-hidden="true">
            <div className="marketingPhone">
              <div className="marketingPhoneScreen">
                <div className="marketingPhoneHeader">
                  <span className="marketingPhoneBack" />
                  <span className="marketingPhoneStatus" />
                </div>
                <div className="marketingPhoneCard">
                  <span />
                </div>
                <div className="marketingPhoneCard marketingPhoneCardMuted">
                  <span className="marketingPhoneCardLabel">EXECUTE COMMAND</span>
                </div>
              </div>
            </div>
            <span className="marketingConnectionGlyph">))</span>
            <div className="marketingNodeConsole">
              <span className="marketingNodeConsoleHeader">REMOTE RUNNER</span>
              <code>
                {`$ deploy --target=prod\n`}
                {`> handshake complete\n`}
                {`> remote task queued`}
              </code>
            </div>
          </div>

          <div className="marketingControlCopy">
            <span className="marketingSectionLabel">Unified Control</span>
            <h2>
              Command your infrastructure from <span>any</span> device.
            </h2>
            <p>
              Remote Codex isn&apos;t just a terminal; it&apos;s a bridge. Access your full development environment,
              run scripts, and manage deployments from your phone while commuting or from another workstation without
              SSH configuration headaches.
            </p>
            <div className="marketingHighlightGrid">
              {controlHighlights.map((item) => (
                <div key={item.title} className={item.accent}>
                  <strong>{item.title}</strong>
                  <span>{item.description}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="marketingSection marketingAutomationSection">
        <div className="marketingSectionFrame marketingSectionFrameCentered">
          <div className="marketingIntro">
            <h2>Natural Language to Automated Cron</h2>
            <p>
              Stop wrestling with cron syntax. Describe your automation intent, and let Remote Codex orchestrate the
              scheduling and delivery.
            </p>
          </div>

          <div className="marketingAutomationGrid">
            <article className="marketingAutomationCard marketingAutomationCardWide">
              <span className="marketingCardGlyph" aria-hidden="true">
                ✣
              </span>
              <h3>“Monitor my database backups and slack me every Sunday morning at 8am.”</h3>
              <div className="marketingCronSnippet">
                <code>0 8 * * 0 /usr/local/bin/codex run backup-check --notify slack</code>
              </div>
              <p>Remote Codex translates your intent into reliable background tasks instantly.</p>
              <div className="marketingAutomationFooter">
                <span className="marketingAutomationPill">Collaborative automation intelligence</span>
              </div>
            </article>

            <article className="marketingAutomationCard">
              <span className="marketingCardGlyph" aria-hidden="true">
                ✦
              </span>
              <h3>Result Tracking</h3>
              <p>Receive execution logs and status reports directly in your Codex Studio or preferred notification channel.</p>
              <div className="marketingStatusList">
                <div className="marketingStatusRow">
                  <span>Daily Sync</span>
                  <strong>SUCCESS</strong>
                </div>
                <div className="marketingStatusRow marketingStatusRowMuted">
                  <span>SSL Check</span>
                  <strong>PENDING</strong>
                </div>
              </div>
            </article>
          </div>
        </div>
      </section>

      <section className="marketingSection marketingLaunchSection">
        <div className="marketingSectionFrame">
          <div className="marketingLaunchCard">
            <h2>Ready to Orchestrate?</h2>
            <p>Join the future of remote terminal control and automation. Start your first codex node in seconds.</p>
            <Link className="marketingPrimaryButton" to={studioEntryPath}>
              Launch Studio Now
            </Link>
            <div className="marketingRuntimeBadges" aria-hidden="true">
              {runtimeBadges.map((badge) => (
                <span key={badge}>{badge}</span>
              ))}
            </div>
          </div>
        </div>
      </section>

      <MarketingFooter />
    </main>
  );
}
