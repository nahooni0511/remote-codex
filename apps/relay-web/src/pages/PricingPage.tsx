import type { RelayAuthSession } from "@remote-codex/contracts";
import { Link } from "react-router-dom";

import { MarketingFooter, MarketingTopNav } from "../components/MarketingChrome";
import { MARKETING_DOCS_URL } from "../lib/marketing";
import { getStudioEntryPath } from "../lib/routes";

const plans = [
  {
    name: "Standard",
    accent: "pricingCardLabel",
    price: "$3",
    cadence: "/mo",
    description: "For developers managing individual cloud instances.",
    buttonLabel: "Get Started",
    featured: false,
    features: [
      "Remote Control Dashboard",
      "Up to 5 Active Nodes",
      "Basic AI-to-Cron Translation",
      "Standard API Access",
    ],
  },
  {
    name: "Pro Fleet",
    accent: "pricingCardLabel pricingCardLabelHot",
    price: "$29",
    cadence: "/yr",
    description: "Full orchestration for professional workflows and scale.",
    buttonLabel: "Select Pro Plan",
    featured: true,
    features: [
      "Unlimited Node Clusters",
      "Advanced AI Logic Controllers",
      "Easy Setup Script Generators",
      "Priority Infrastructure Support",
      "Custom Webhook Integration",
    ],
  },
] as const;

const comparisonRows = [
  { capability: "Parallel Command Execution", standard: "Limited (2)", pro: "Unlimited" },
  { capability: "Automation Logs Retention", standard: "7 Days", pro: "90 Days" },
  { capability: "Custom Shell Environments", standard: false, pro: true },
  { capability: "Dedicated Instance Runner", standard: false, pro: true },
] as const;

function CheckIcon() {
  return (
    <svg aria-hidden="true" className="pricingCheckIcon" viewBox="0 0 16 16">
      <path d="M3.5 8.25 6.6 11.35 12.5 5.45" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.75" />
    </svg>
  );
}

function PricingFeatureIcon() {
  return (
    <span className="pricingFeatureBullet" aria-hidden="true">
      <CheckIcon />
    </span>
  );
}

export function PricingPage({ session }: { session: RelayAuthSession }) {
  const studioEntryPath = getStudioEntryPath(Boolean(session.user));

  return (
    <main className="marketingPage">
      <MarketingTopNav activePage="pricing" session={session} />

      <section className="marketingSection pricingHero">
        <div className="marketingSectionFrame marketingSectionFrameCentered">
          <h1 className="pricingTitle">
            Scalable <span>Automation</span>. Predictable Pricing.
          </h1>
          <p className="pricingLead">
            Deploy orchestrated terminal commands across your entire remote fleet. Choose the plan that fits your
            execution volume.
          </p>
          <div className="pricingToggle" aria-hidden="true">
            <span className="pricingToggleLabel pricingToggleLabelMuted">Monthly</span>
            <span className="pricingToggleTrack">
              <span className="pricingToggleThumb" />
            </span>
            <span className="pricingToggleLabel">Yearly</span>
            <span className="pricingToggleBadge">Save 20%</span>
          </div>

          <div className="pricingGrid">
            {plans.map((plan) => (
              <article key={plan.name} className={plan.featured ? "pricingCard pricingCardFeatured" : "pricingCard"}>
                {plan.featured ? <span className="pricingPopularBadge">Most Popular</span> : null}
                <span className={plan.accent}>{plan.name}</span>
                <div className="pricingPriceRow">
                  <strong>{plan.price}</strong>
                  <span>{plan.cadence}</span>
                </div>
                <p className="pricingCardDescription">{plan.description}</p>
                <ul className="pricingFeatureList">
                  {plan.features.map((feature) => (
                    <li key={feature} className="pricingFeatureItem">
                      <PricingFeatureIcon />
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>
                <Link className={plan.featured ? "pricingCardButton pricingCardButtonPrimary" : "pricingCardButton pricingCardButtonGhost"} to={studioEntryPath}>
                  {plan.buttonLabel}
                </Link>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="marketingSection pricingFeatureSection">
        <div className="marketingSectionFrame">
          <div className="pricingBentoGrid">
            <article className="pricingBentoCard pricingBentoWide">
              <span className="pricingBentoIcon pricingBentoIconWide" aria-hidden="true" />
              <h2>Command Center</h2>
              <p>
                A centralized orchestration layer to manage diverse commands across staging, unified runtime, and
                multi-tenant execution.
              </p>
              <div className="pricingTags">
                <span>LOW-LATENCY</span>
                <span>MULTI-TENANT</span>
              </div>
            </article>

            <article className="pricingBentoCard">
              <span className="pricingBentoIcon pricingBentoIconSpark" aria-hidden="true" />
              <h2>AI-to-Cron</h2>
              <p>Speak your automation. “Back up my DB every Tuesday at 3 AM” becomes an optimized cron job in seconds.</p>
            </article>

            <article className="pricingBentoCard">
              <span className="pricingBentoIcon pricingBentoIconBolt" aria-hidden="true" />
              <h2>Easy Setup</h2>
              <p>One-line install with no complex configurations. Up and running in under 60 seconds.</p>
            </article>

            <article className="pricingBentoCard pricingBentoTall">
              <div>
                <span className="pricingBentoIcon pricingBentoIconShield" aria-hidden="true" />
                <h2>Encrypted Tunneling</h2>
                <p>
                  Every packet is wrapped in TLS 1.3 with optional hardware-key authentication. Your commands never
                  travel the open web unencrypted.
                </p>
              </div>
              <div className="pricingTerminalMini">
                <span className="pricingTerminalMiniLabel">REMOTE-CODEX SECURE TUNNEL</span>
                <code>
                  {`$ remote-codex encrypt --target=all\n`}
                  {`> handshake complete\n`}
                  {`> tunnel established`}
                </code>
              </div>
            </article>
          </div>
        </div>
      </section>

      <section className="marketingSection pricingComparisonSection">
        <div className="marketingSectionFrame pricingComparison">
          <h2>Detailed Comparison</h2>
          <div className="pricingTable">
            <div className="pricingTableRow pricingTableHead">
              <span>Core Capabilities</span>
              <span>Standard</span>
              <span>Pro Fleet</span>
            </div>
            {comparisonRows.map((row) => (
              <div key={row.capability} className="pricingTableRow">
                <span>{row.capability}</span>
                <span className="pricingTableValue">
                  {typeof row.standard === "boolean" ? row.standard ? <CheckIcon /> : "×" : row.standard}
                </span>
                <span className="pricingTableValue pricingTableValueStrong">
                  {typeof row.pro === "boolean" ? row.pro ? <CheckIcon /> : "×" : row.pro}
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="marketingSection pricingCtaSection">
        <div className="marketingSectionFrame">
          <div className="pricingCtaCard">
            <h2>Ready to orchestrate?</h2>
            <p>Join 5,000+ developers automating their remote infrastructure with the Codex engine.</p>
            <div className="pricingCtaActions">
              <Link className="pricingCardButton pricingCardButtonPrimary" to={studioEntryPath}>
                Start Free Trial
              </Link>
              <a className="pricingCardButton pricingCardButtonGhost" href={MARKETING_DOCS_URL} rel="noreferrer" target="_blank">
                Book a Demo
              </a>
            </div>
          </div>
        </div>
      </section>

      <MarketingFooter />
    </main>
  );
}
