import type { RelayAuthSession } from "@remote-codex/contracts";
import { Link } from "react-router-dom";

import { MARKETING_CHANGELOG_URL, MARKETING_DOCS_URL, MARKETING_FOOTER_ITEMS } from "../lib/marketing";
import { PRICING_PATH, getStudioEntryPath } from "../lib/routes";

type MarketingTopNavProps = {
  activePage: "landing" | "pricing";
  session: RelayAuthSession;
};

export function MarketingTopNav({ activePage, session }: MarketingTopNavProps) {
  const studioEntryPath = getStudioEntryPath(Boolean(session.user));
  const featuresHref = activePage === "landing" ? "#features" : "/#features";

  return (
    <header className="marketingTopbar">
      <div className="marketingTopbarInner">
        <div className="marketingBrandGroup">
          <Link className="marketingBrand" to="/">
            remote-codex
          </Link>
          <nav className="marketingNav" aria-label="Marketing navigation">
            <a className="marketingNavLink" href={featuresHref}>
              Features
            </a>
            <Link className={activePage === "pricing" ? "marketingNavLink marketingNavLinkActive" : "marketingNavLink"} to={PRICING_PATH}>
              Pricing
            </Link>
            <a className="marketingNavLink" href={MARKETING_DOCS_URL} rel="noreferrer" target="_blank">
              Docs
            </a>
            <a className="marketingNavLink" href={MARKETING_CHANGELOG_URL} rel="noreferrer" target="_blank">
              Changelog
            </a>
          </nav>
        </div>
        <div className="marketingTopbarActions">
          <div className="marketingMenuGlyph" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <Link className="marketingStudioButton" to={studioEntryPath}>
            Go to Studio
          </Link>
        </div>
      </div>
    </header>
  );
}

export function MarketingFooter() {
  return (
    <footer className="marketingFooter">
      <div className="marketingFooterInner">
        <div className="marketingFooterBrand">
          <strong>remote-codex</strong>
          <span>© 2024 Remote Codex. The Orchestrated Terminal.</span>
        </div>
        <div className="marketingFooterLinks" aria-label="Footer links">
          {MARKETING_FOOTER_ITEMS.map((item) =>
            item.href ? (
              <a
                key={item.label}
                className="marketingFooterLink"
                href={item.href}
                rel={item.external ? "noreferrer" : undefined}
                target={item.external ? "_blank" : undefined}
              >
                {item.label}
              </a>
            ) : (
              <span key={item.label} className="marketingFooterLink marketingFooterLinkStatic">
                {item.label}
              </span>
            ),
          )}
        </div>
      </div>
    </footer>
  );
}
