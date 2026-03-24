import type { RelayAuthSession } from "@remote-codex/contracts";
import { Link } from "react-router-dom";

import { MarketingFooter, MarketingTopNav } from "../components/MarketingChrome";
import { MARKETING_DOCS_URL } from "../lib/marketing";
import { getStudioEntryPath } from "../lib/routes";

const featureIconBottle = "https://www.figma.com/api/mcp/asset/c1c20998-d708-4016-b46c-38549fd02272";
const featureIconTelegram = "https://www.figma.com/api/mcp/asset/822e2d44-c592-4ef8-bc19-f724a1407742";
const featureIconCron = "https://www.figma.com/api/mcp/asset/437d8915-66e8-4fa7-b920-a381920f0ae3";

const capabilityHighlights = [
  {
    title: "Remote Control",
    description: "Command your system with a sleek interface designed for high-latency environments and precise execution.",
    icon: featureIconBottle,
  },
  {
    title: "Telegram Integration",
    description: "Real-time alerts and management via Telegram. Receive critical notifications and issue commands through a secure bot.",
    icon: featureIconTelegram,
  },
  {
    title: "Cron-based Tasks",
    description: "Automate your workflows effortlessly. Schedule complex logic and recurring maintenance with our intuitive cron engine.",
    icon: featureIconCron,
  },
] as const;

const setupSteps = [
  {
    step: "STEP 01",
    title: "Installation",
    description: "Download and initialize the Remote Codex binaries on your host machine.",
    lines: ["curl -fsSL https://remote-codex.com/install.sh | bash"],
  },
  {
    step: "STEP 02",
    title: "Local Access",
    description: "Verify the installation by accessing the local management dashboard.",
    lines: ["http://localhost:3000"],
  },
  {
    step: "STEP 03",
    title: "Remote Access",
    description: "Generate a secure pairing code to bridge your instance to the global studio.",
    lines: ["# Generate pairing code at:", "https://remote-codex.com", "", "# Apply code in local dashboard at:", "http://localhost:3000"],
  },
] as const;

export function MarketingPage({ session }: { session: RelayAuthSession }) {
  const studioEntryPath = getStudioEntryPath(Boolean(session.user));

  return (
    <main className="marketingPage marketingPageLanding">
      <MarketingTopNav activePage="landing" session={session} />

      <section className="marketingSection marketingHero marketingHeroSimple">
        <div className="marketingSectionFrame marketingSectionFrameCentered">
          <div className="marketingHeroCopy marketingHeroCopyCentered">
            <span className="marketingHeroBadge">Web-first remote workspace access</span>
            <h1 className="marketingHeroTitle">
              Remote Codex: Control <span>anywhere, anytime</span>
            </h1>
            <p className="marketingHeroLead">
              Experience total control of your Codex instance directly from your mobile device or any web browser.
              Professional-grade infrastructure at your fingertips.
            </p>
            <div className="marketingHeroActions marketingHeroActionsCentered">
              <Link className="marketingPrimaryButton" to={studioEntryPath}>
                Open Studio
              </Link>
              <a className="marketingSecondaryButton" href={MARKETING_DOCS_URL} rel="noreferrer" target="_blank">
                View Docs
              </a>
            </div>
          </div>
        </div>
      </section>

      <section className="marketingBand" id="features">
        <div className="marketingSectionFrame marketingSectionFrameCentered">
          <div className="marketingIntro marketingIntroCompact">
            <h2>Core Capabilities</h2>
          </div>

          <div className="marketingFeatureGrid">
            {capabilityHighlights.map((item, index) => (
              <article key={item.title} className="marketingFeatureCard">
                <span className="marketingFeatureIcon" aria-hidden="true">
                  <img alt="" src={item.icon} />
                </span>
                <h3>{item.title}</h3>
                <p>{item.description}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="marketingSection marketingSetupSection" id="setup">
        <div className="marketingSectionFrame marketingSectionFrameCentered">
          <div className="marketingIntro">
            <h2>Seamless Setup</h2>
            <p>
              Get your environment running in under 60 seconds. Copy, paste, and deploy.
            </p>
          </div>

          <div className="marketingSetupGrid">
            {setupSteps.map((step) => (
              <article key={step.step} className="marketingSetupCard">
                <span className="marketingSetupStep">{step.step}</span>
                <h3>{step.title}</h3>
                <p>{step.description}</p>
                <div className="marketingCodePanel">
                  <code>
                    {step.lines.map((line) => `${line}\n`).join("").trimEnd()}
                  </code>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <MarketingFooter activePage="landing" />
    </main>
  );
}
