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
  const navItems =
    activePage === "landing"
      ? [
          { label: "Features", href: "#features", external: false },
          { label: "Setup", href: "#setup", external: false },
          { label: "Documentation", href: MARKETING_DOCS_URL, external: true },
        ]
      : [
          { label: "Features", href: "/#features", external: false },
          { label: "Pricing", href: PRICING_PATH, external: false, active: true },
          { label: "Docs", href: MARKETING_DOCS_URL, external: true },
          { label: "Changelog", href: MARKETING_CHANGELOG_URL, external: true },
        ];

  return (
    <header className="marketingTopbar">
      <div className="marketingTopbarInner">
        <div className="marketingBrandGroup">
          <Link className="marketingBrand" to="/">
            remote-codex
          </Link>
          <nav className="marketingNav" aria-label="Marketing navigation">
            {navItems.map((item) =>
              item.external ? (
                <a key={item.label} className="marketingNavLink" href={item.href} rel="noreferrer" target="_blank">
                  {item.label}
                </a>
              ) : item.href.startsWith("/") ? (
                <Link
                  key={item.label}
                  className={item.active ? "marketingNavLink marketingNavLinkActive" : "marketingNavLink"}
                  to={item.href}
                >
                  {item.label}
                </Link>
              ) : (
                <a key={item.label} className="marketingNavLink" href={item.href}>
                  {item.label}
                </a>
              ),
            )}
          </nav>
        </div>
        <div className="marketingTopbarActions">
          {activePage === "pricing" ? (
            <div className="marketingMenuGlyph" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
          ) : null}
          <Link className="marketingStudioButton" to={studioEntryPath}>
            Go to Studio
          </Link>
        </div>
      </div>
    </header>
  );
}

export function MarketingFooter({ activePage }: { activePage: "landing" | "pricing" }) {
  if (activePage === "landing") {
    return (
      <footer className="marketingFooter marketingFooterLanding">
        <div className="marketingFooterInner marketingFooterInnerLanding">
          <div className="marketingFooterBrand">
            <strong>Remote Codex</strong>
          </div>
          <div className="marketingFooterLinks marketingFooterLinksLanding" aria-label="Footer links">
            <span className="marketingFooterLink marketingFooterLinkStatic">Privacy</span>
            <span className="marketingFooterLink marketingFooterLinkStatic">Terms</span>
            <a className="marketingFooterLink" href={MARKETING_DOCS_URL} rel="noreferrer" target="_blank">
              GitHub
            </a>
            <span className="marketingFooterLink marketingFooterLinkStatic">Status</span>
          </div>
          <div className="marketingFooterMeta">© 2024 Remote Codex. The Digital Architect&apos;s Blueprint.</div>
        </div>
      </footer>
    );
  }

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
