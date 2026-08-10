"use client";

import { useEffect, useState } from "react";

import Link from "next/link";

import "./landing.css";

type Theme = "light" | "dark";

/**
 * Marketing landing page for Subrails, ported from subrails-mockup.html.
 * The on-chain reference app lives at /demo.
 */
export default function LandingPage(): React.ReactElement {
  const [theme, setTheme] = useState<Theme>("light");

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  const toggleTheme = (): void => {
    setTheme((current) => (current === "light" ? "dark" : "light"));
  };

  return (
    <div className="landing">
      <header>
        <div className="brand">subrails</div>
        <nav>
          <a href="#how">How it works</a>
          <a href="#compare">Why</a>
          <a href="#start">Docs</a>
          <button type="button" className="toggle" onClick={toggleTheme}>
            {theme === "light" ? "DARK" : "LIGHT"}
          </button>
        </nav>
      </header>

      <section className="hero">
        <div className="wrap">
          <div className="eyebrow">Recurring authorization on Stellar</div>
          <h1>
            Crypto has no <em>direct debit.</em> Subrails is the missing rail.
          </h1>
          <p className="lede">
            A subscriber authorizes a merchant once, on chain, with hard limits: a maximum per charge, a fixed
            interval, an expiry. The merchant pulls each payment when it is due. Nothing lets them charge more, charge
            early, or charge after it ends.
          </p>
          <div className="hero-actions">
            <a href="#start" className="btn btn-primary">
              Read the quickstart
            </a>
            <a href="#how" className="btn btn-ghost">
              See the mechanism
            </a>
          </div>
        </div>
      </section>

      <section className="strip-section">
        <div className="wrap">
          <div className="strip-label">One mandate, as it lives on chain</div>
          <div className="mandate">
            <div className="mandate-head">
              <span className="mandate-id">mandate #0431 · account G7QF…3JHM → merchant GBRK…9WPA</span>
              <span className="mandate-status">
                <span className="dot" />
                Active
              </span>
            </div>
            <div className="mandate-grid">
              <div className="cell">
                <div className="cell-label">Cap per charge</div>
                <div className="cell-value">
                  10.00 <small>USDC</small>
                </div>
              </div>
              <div className="cell">
                <div className="cell-label">Interval</div>
                <div className="cell-value">
                  30 <small>days</small>
                </div>
              </div>
              <div className="cell">
                <div className="cell-label">Expires</div>
                <div className="cell-value">
                  12 <small>charges left</small>
                </div>
              </div>
            </div>
            <div className="mandate-foot">
              <span>next charge valid at ledger 58,204,119</span>
              <span>revocable by the subscriber, any time</span>
            </div>
          </div>
        </div>
      </section>

      <section className="how" id="how">
        <div className="wrap">
          <h2>How a charge is authorized</h2>
          <p className="section-note">
            The subscriber never hands over a key and never leaves a standing allowance exposed. The rules live inside
            a delegated signer, enforced by the network on every pull.
          </p>
          <div className="steps">
            <div className="step">
              <div className="step-num">01</div>
              <div className="step-body">
                <h3>The subscriber sets the terms</h3>
                <p>
                  They create a mandate naming one merchant, one token, a cap, an interval, and an expiry. It is
                  stored on chain by the <code>mandate-policy</code> contract and registered to their smart account.
                </p>
              </div>
            </div>
            <div className="step">
              <div className="step-num">02</div>
              <div className="step-body">
                <h3>The merchant submits a charge when it is due</h3>
                <p>
                  The transaction moves the exact amount from the subscriber&apos;s account. Authorization is not an
                  inline signature. The account delegates the decision to the policy contract.
                </p>
              </div>
            </div>
            <div className="step">
              <div className="step-num">03</div>
              <div className="step-body">
                <h3>The policy checks every rule, then answers</h3>
                <p>
                  Inside <code>__check_auth</code>, the policy verifies the token, the merchant, the amount against
                  the cap, the interval since the last charge, and the expiry. Any failure rejects the whole
                  transaction. On success it advances the next valid ledger and lets the transfer settle.
                </p>
              </div>
            </div>
            <div className="step">
              <div className="step-num">04</div>
              <div className="step-body">
                <h3>Either party can revoke</h3>
                <p>
                  The subscriber or the merchant can end the mandate. After that, no further charge authorizes. There
                  is no window where a cancelled subscription keeps drawing funds.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="compare" id="compare">
        <div className="wrap">
          <h2>What this replaces</h2>
          <p className="section-note">
            The ways recurring payment is done on chain today, and what changes when the limits are enforced by the
            protocol instead of by trust.
          </p>
          <div className="compare-grid">
            <div className="col col-old">
              <h4>Without Subrails</h4>
              <ul>
                <li>Sign every single payment by hand, forever</li>
                <li>Or grant a token allowance that a spender can drain</li>
                <li>Or hand custody of keys to a third party</li>
                <li>Cancellation depends on the merchant honoring it</li>
              </ul>
            </div>
            <div className="col col-new">
              <h4>With Subrails</h4>
              <ul>
                <li>Authorize once, with limits fixed on chain</li>
                <li>The cap is enforced per charge, not left open</li>
                <li>No key custody and no exposed allowance</li>
                <li>Revocation is enforced by the network, not a promise</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      <section className="cta-band" id="start">
        <div className="wrap">
          <h2>Built on Protocol 27 delegation</h2>
          <p>
            Subrails is an open protocol. Two repositories: the Soroban contracts and the TypeScript SDK with a
            reference app. Apache licensed.
          </p>
          <Link href="/demo" className="btn btn-primary">
            Open the reference app
          </Link>
          <div className="quickstart">
            <div className="qs-bar">
              <span>quickstart</span>
              <span>testnet</span>
            </div>
            <div className="qs-body">
              <span className="c"># install the sdk</span>
              <br />
              npm add <span className="g">@subrails/sdk</span>
              <br />
              <br />
              <span className="c"># create a mandate: cap, interval, expiry</span>
              <br />
              subrails.<span className="g">createMandate</span>({"{ merchant, token, cap, interval, expiry }"})
            </div>
          </div>
        </div>
      </section>

      <footer className="wrap">
        <div>
          <div className="foot-brand">subrails</div>
          <p className="foot-meta">
            Recurring authorization for Stellar. Not audited. Use on testnet until a formal review is published.
          </p>
        </div>
        <div className="foot-links">
          <a href="#">Contracts</a>
          <a href="#">SDK</a>
          <a href="#">Docs</a>
          <a href="#">GitHub</a>
        </div>
      </footer>
    </div>
  );
}
