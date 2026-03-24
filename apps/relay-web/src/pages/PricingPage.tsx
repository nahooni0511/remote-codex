import { ErrorCode, LogLevel, Purchases, PurchasesError, type Package as RevenueCatPackage } from "@revenuecat/purchases-js";
import type { RelayAuthSession, RelayBillingStatusResponse } from "@remote-codex/contracts";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { MARKETING_DOCS_URL } from "../lib/marketing";
import { getStudioEntryPath } from "../lib/routes";
import { fetchRelayJson } from "../lib/relay-api";

const pricingCheckIcon = "https://www.figma.com/api/mcp/asset/e002b5b5-7b43-4f00-bcac-2a8252695f26";
const pricingLockIcon = "https://www.figma.com/api/mcp/asset/35d5b11d-e2e1-4958-97d5-60be0493bf4c";

const pricingFeatures = ["Full Remote Control", "Telegram Alerts", "Unlimited Cron Jobs"] as const;

function readErrorMessage(caught: unknown): string {
  return caught instanceof Error ? caught.message : "The billing request failed.";
}

export function PricingPage({ session }: { session: RelayAuthSession }) {
  const navigate = useNavigate();
  const studioEntryPath = getStudioEntryPath(Boolean(session.user));
  const purchasesRef = useRef<Purchases | null>(null);
  const [billingStatus, setBillingStatus] = useState<RelayBillingStatusResponse | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(Boolean(session.user));
  const [purchasePending, setPurchasePending] = useState(false);
  const [packageState, setPackageState] = useState<{
    formattedPrice: string | null;
    hasTrial: boolean;
    rcPackage: RevenueCatPackage | null;
  }>({
    formattedPrice: null,
    hasTrial: false,
    rcPackage: null,
  });
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  useEffect(() => {
    Purchases.setLogLevel(LogLevel.Error);
    return () => {
      purchasesRef.current?.close();
      purchasesRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!session.user) {
      setBillingStatus(null);
      setLoadingStatus(false);
      setStatusMessage(null);
      return;
    }

    let cancelled = false;
    setLoadingStatus(true);
    setStatusMessage(null);

    void fetchRelayJson<RelayBillingStatusResponse>("/api/billing/status")
      .then((result) => {
        if (!cancelled) {
          setBillingStatus(result);
        }
      })
      .catch((caught: Error) => {
        if (!cancelled) {
          setBillingStatus(null);
          setStatusMessage(caught.message);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingStatus(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [session.user?.id]);

  useEffect(() => {
    if (!session.user || !billingStatus?.enabled || !billingStatus.appUserId || !billingStatus.publicApiKey) {
      setPackageState({
        formattedPrice: null,
        hasTrial: false,
        rcPackage: null,
      });
      return;
    }

    let cancelled = false;

    const loadCatalog = async () => {
      try {
        const purchases = getPurchasesClient({
          appUserId: billingStatus.appUserId!,
          publicApiKey: billingStatus.publicApiKey!,
        });
        const offerings = await purchases.getOfferings({
          offeringIdentifier: billingStatus.offeringLookupKey || undefined,
        });
        const offering = billingStatus.offeringLookupKey
          ? offerings.all[billingStatus.offeringLookupKey] || offerings.current
          : offerings.current;
        const rcPackage = offering?.availablePackages[0] || null;
        if (!cancelled) {
          setPackageState({
            formattedPrice: rcPackage?.webBillingProduct.price.formattedPrice || null,
            hasTrial: rcPackage?.webBillingProduct.freeTrialPhase !== null,
            rcPackage,
          });
        }
      } catch (caught) {
        if (!cancelled) {
          setPackageState({
            formattedPrice: null,
            hasTrial: false,
            rcPackage: null,
          });
          setStatusMessage(readErrorMessage(caught));
        }
      }
    };

    void loadCatalog();

    return () => {
      cancelled = true;
    };
  }, [
    billingStatus?.appUserId,
    billingStatus?.enabled,
    billingStatus?.offeringLookupKey,
    billingStatus?.publicApiKey,
    session.user,
  ]);

  function getPurchasesClient(input: {
    appUserId: string;
    publicApiKey: string;
  }) {
    if (purchasesRef.current && purchasesRef.current.getAppUserId() === input.appUserId) {
      return purchasesRef.current;
    }

    if (purchasesRef.current) {
      purchasesRef.current.close();
    }

    purchasesRef.current = Purchases.configure({
      apiKey: input.publicApiKey,
      appUserId: input.appUserId,
      flags: {
        collectAnalyticsEvents: false,
        storeLoadTime: "purchase_start",
      },
    });

    return purchasesRef.current;
  }

  async function handlePurchase() {
    if (!session.user) {
      navigate(studioEntryPath);
      return;
    }

    if (!billingStatus?.enabled || !billingStatus.publicApiKey || !billingStatus.appUserId) {
      setStatusMessage("Billing is not configured yet. Please finish the RevenueCat setup first.");
      return;
    }

    if (!packageState.rcPackage) {
      setStatusMessage("Checkout package is still loading. Please try again in a moment.");
      return;
    }

    setPurchasePending(true);
    setStatusMessage(null);

    try {
      const purchases = getPurchasesClient({
        appUserId: billingStatus.appUserId,
        publicApiKey: billingStatus.publicApiKey,
      });
      const result = await purchases.purchase({
        rcPackage: packageState.rcPackage,
        customerEmail: session.user.email || undefined,
        selectedLocale: navigator.language || "en-US",
        skipSuccessPage: true,
      });
      const entitlementLookupKey = billingStatus.entitlementLookupKey || "pro";
      const nextActive = Boolean(result.customerInfo.entitlements.active[entitlementLookupKey]);

      setBillingStatus((current) => (current ? { ...current, active: nextActive } : current));

      if (nextActive) {
        navigate(studioEntryPath);
        return;
      }

      setStatusMessage("Purchase completed, but the entitlement is not active yet. Refresh and try opening Studio again.");
    } catch (caught) {
      if (caught instanceof PurchasesError && caught.errorCode === ErrorCode.UserCancelledError) {
        setStatusMessage(null);
      } else {
        setStatusMessage(readErrorMessage(caught));
      }
    } finally {
      setPurchasePending(false);
    }
  }

  const priceLabel = packageState.formattedPrice || "$120";
  const billingReady = Boolean(
    billingStatus?.enabled && billingStatus.publicApiKey && billingStatus.appUserId && packageState.rcPackage,
  );
  const primaryButtonLabel = !session.user
    ? "Sign In to Subscribe"
    : loadingStatus
      ? "Checking Subscription..."
      : billingStatus?.active
        ? "Open Studio"
        : purchasePending
          ? "Launching Checkout..."
          : billingReady
            ? "Start Subscription"
            : "Billing Setup Pending";
  const helperText = billingStatus?.active
    ? "Subscription active. Remote access is unlocked for this account."
    : packageState.hasTrial
      ? "Includes trial access before billing begins."
      : "Secure checkout with instant activation after purchase.";

  return (
    <main className="marketingPage pricingSinglePage">
      <header className="pricingSingleTopbar">
        <div className="pricingSingleTopbarInner">
          <Link className="pricingSingleBrand" to="/">
            Remote Codex
          </Link>

          <nav className="pricingSingleNav" aria-label="Pricing navigation">
            <a className="pricingSingleNavLink" href={MARKETING_DOCS_URL} rel="noreferrer" target="_blank">
              Docs
            </a>
            <Link className="pricingSingleNavLink" to={studioEntryPath}>
              Studio
            </Link>
            <a className="pricingSingleNavLink" href={MARKETING_DOCS_URL} rel="noreferrer" target="_blank">
              Community
            </a>
            <span className="pricingSingleNavLink pricingSingleNavLinkActive">Pricing</span>
          </nav>

          <Link className="pricingSingleStudioButton" to={studioEntryPath}>
            Open Studio
          </Link>
        </div>
      </header>

      <section className="pricingSingleHero">
        <div className="pricingSingleGlow pricingSingleGlowLeft" aria-hidden="true" />
        <div className="pricingSingleGlow pricingSingleGlowRight" aria-hidden="true" />

        <div className="pricingSingleHeroInner">
          <div className="pricingSingleHeading">
            <h1>Simple, Engineered Pricing.</h1>
            <p>One tier. Total control. Professional precision for your remote workflows.</p>
          </div>

          <div className="pricingSingleToggle" aria-hidden="true">
            <span className="pricingSingleToggleOption">Monthly</span>
            <span className="pricingSingleToggleOption pricingSingleToggleOptionActive">
              <span>Annual</span>
              <span className="pricingSingleToggleSavings">Save $24</span>
            </span>
          </div>

          <article className="pricingSingleCard">
            <div className="pricingSingleCardAccent" aria-hidden="true" />

            <div className="pricingSingleCardBody">
              <div className="pricingSingleCardHeader">
                <div>
                  <h2>Pro Studio</h2>
                  <p>Architect Grade</p>
                </div>
                <span className="pricingSingleBadge">Top Tier</span>
              </div>

              <div className="pricingSinglePriceBlock">
                <div className="pricingSinglePriceRow">
                  <strong>{priceLabel}</strong>
                  <span>/year</span>
                </div>
                <p>{helperText}</p>
              </div>

              <ul className="pricingSingleFeatureList">
                {pricingFeatures.map((feature) => (
                  <li key={feature} className="pricingSingleFeatureItem">
                    <img alt="" src={pricingCheckIcon} />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>

              {session.user && billingStatus?.active ? (
                <Link className="pricingSinglePrimaryButton" to={studioEntryPath}>
                  {primaryButtonLabel}
                </Link>
              ) : (
                <button
                  className="pricingSinglePrimaryButton"
                  disabled={loadingStatus || purchasePending || (Boolean(session.user) && !billingReady)}
                  onClick={() => {
                    void handlePurchase();
                  }}
                  type="button"
                >
                  {primaryButtonLabel}
                </button>
              )}

              <p className="pricingSingleMeta">Remote access gate • Cancel anytime • Activation follows entitlement status</p>
              {statusMessage ? <p className="pricingSingleMessage pricingSingleMessageError">{statusMessage}</p> : null}
            </div>

            <div className="pricingSingleCardFooter">
              <span>ENCRYPTED_SESSION_v2.4</span>
              <img alt="" src={pricingLockIcon} />
            </div>
          </article>
        </div>
      </section>

      <footer className="pricingSingleFooter">
        <div className="pricingSingleFooterInner">
          <strong className="pricingSingleFooterBrand">Remote Codex</strong>
          <div className="pricingSingleFooterLinks" aria-label="Pricing footer links">
            <span>Terms</span>
            <span>Privacy</span>
            <span>Security</span>
            <span>Status</span>
          </div>
          <span className="pricingSingleFooterMeta">© 2024 Remote Codex. Engineered for precision.</span>
        </div>
      </footer>
    </main>
  );
}
