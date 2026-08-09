"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { Header } from "@/components/Header";
import { MandateBoard } from "@/components/MandateBoard";
import { MerchantPanel } from "@/components/MerchantPanel";
import { SubscriberPanel } from "@/components/SubscriberPanel";
import type { Toast } from "@/components/SubscriberPanel";

import { loadWebConfig } from "@/lib/config";
import { shortenAddress } from "@/lib/format";
import { policyClient, tokenClient } from "@/lib/sdk-clients";

const CONFIG = loadWebConfig();

const LS_ACCOUNT = "subrails.demo.account";
const LS_TOKEN = "subrails.demo.token";
const LS_MERCHANT = "subrails.demo.merchant";
const LS_MANDATE = "subrails.demo.mandate";

function readStored(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStored(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Storage can be unavailable (private mode); the session still works.
  }
}

export default function Page(): React.ReactElement {
  const [accountId, setAccountId] = useState<string | null>(() => readStored(LS_ACCOUNT));
  const [tokenId, setTokenId] = useState<string>(() => readStored(LS_TOKEN) ?? "");
  const [merchant, setMerchant] = useState<string>(() => readStored(LS_MERCHANT) ?? "");
  const [latestMandateId, setLatestMandateId] = useState<bigint | null>(() => {
    const raw = readStored(LS_MANDATE);
    return raw === null ? null : BigInt(raw);
  });
  const [currentLedger, setCurrentLedger] = useState<number | null>(null);
  const [indexerOk, setIndexerOk] = useState<boolean | null>(null);
  const [tokenMeta, setTokenMeta] = useState<{ symbol: string; decimals: number } | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastId = useRef(0);

  const pushToast = useCallback((kind: Toast["kind"], title: string, detail?: string) => {
    const id = ++toastId.current;
    setToasts((current) => [...current, { id, kind, title, detail }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, 7000);
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function pollLedger(): Promise<void> {
      try {
        const ledger = await policyClient(CONFIG.sdk).ledger();
        if (!cancelled) {
          setCurrentLedger(ledger);
        }
      } catch {
        // The ledger read is best effort.
      }
    }
    void pollLedger();
    const timer = window.setInterval(() => void pollLedger(), 15_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadTokenMeta(): Promise<void> {
      if (tokenId.trim() === "") {
        setTokenMeta(null);
        return;
      }
      try {
        const token = tokenClient(CONFIG.sdk, tokenId.trim());
        const [symbol, decimals] = await Promise.all([token.symbol(), token.decimals()]);
        if (!cancelled) {
          setTokenMeta({ symbol, decimals });
        }
      } catch {
        if (!cancelled) {
          setTokenMeta(null);
        }
      }
    }
    void loadTokenMeta();
    return () => {
      cancelled = true;
    };
  }, [tokenId]);

  const handleAccountDeployed = useCallback((id: string) => {
    setAccountId(id);
    writeStored(LS_ACCOUNT, id);
    pushToast("info", "Smart account saved", "The account id is kept in this browser for the session.");
  }, [pushToast]);

  const handleTokenIdChange = useCallback((value: string) => {
    setTokenId(value);
    writeStored(LS_TOKEN, value);
  }, []);

  const handleMerchantChange = useCallback((value: string) => {
    setMerchant(value);
    writeStored(LS_MERCHANT, value);
  }, []);

  const handleMandateCreated = useCallback((mandateId: bigint) => {
    setLatestMandateId(mandateId);
    writeStored(LS_MANDATE, mandateId.toString());
  }, []);

  const handleCharged = useCallback(() => {
    // The board polls on its own timer; this just nudges it.
    window.setTimeout(() => setIndexerOk((ok) => ok), 0);
  }, []);

  return (
    <div className="page">
      <Header network={CONFIG.network} indexerOk={indexerOk} currentLedger={currentLedger} />

      <main className="page-inner">
        {!CONFIG.contractsDeployed ? (
          <div className="setup-banner">
            <span className="setup-banner-title">Contracts not deployed yet</span>
            <p>
              The on-chain flow needs MANDATE_POLICY_ID, MANDATE_REGISTRY_ID, and the subrails-account wasm hash. Fill
              them in after deployment, following .env.example at the workspace root. Wallet and indexer status still
              work above.
            </p>
          </div>
        ) : null}

        <section className="hero">
          <h1 className="hero-title">
            Recurring payments with hard on-chain limits
          </h1>
          <p className="hero-sub">
            A subscriber authorizes a merchant to pull charges from their smart account: a max amount per charge, a
            minimum interval, and an expiry. The mandate-policy contract enforces every limit during the charge
            authorization, so a merchant can collect without asking, and never beyond the cap.
          </p>
          <div className="hero-stats">
            <div className="stat">
              <span className="stat-value">{CONFIG.sdk.network}</span>
              <span className="stat-label">network</span>
            </div>
            <div className="stat">
              <span className="stat-value">{CONFIG.sdk.protocol27 ? "CAP-71" : "legacy"}</span>
              <span className="stat-label">authorization</span>
            </div>
            <div className="stat">
              <span className="stat-value">{currentLedger === null ? "\u2013" : currentLedger}</span>
              <span className="stat-label">current ledger</span>
            </div>
          </div>
        </section>

        <div className="role-grid">
          <SubscriberPanel
            config={CONFIG}
            sdk={CONFIG.sdk}
            accountId={accountId}
            currentLedger={currentLedger}
            tokenId={tokenId}
            merchant={merchant}
            latestMandateId={latestMandateId}
            onAccountDeployed={handleAccountDeployed}
            onTokenIdChange={handleTokenIdChange}
            onMandateCreated={handleMandateCreated}
            pushToast={pushToast}
          />
          <MerchantPanel
            config={CONFIG}
            sdk={CONFIG.sdk}
            accountId={accountId}
            currentLedger={currentLedger}
            tokenId={tokenId}
            merchant={merchant}
            latestMandateId={latestMandateId}
            onMerchantChange={handleMerchantChange}
            onCharged={handleCharged}
            pushToast={pushToast}
          />
        </div>

        <MandateBoard
          sdk={CONFIG.sdk}
          indexerUrl={CONFIG.indexerUrl}
          accountId={accountId}
          tokenDecimals={tokenMeta?.decimals ?? null}
          tokenSymbol={tokenMeta?.symbol ?? "token"}
          onIndexerStatusChange={setIndexerOk}
          pushToast={pushToast}
        />

        <footer className="footer">
          <p>
            Subrails is a reference implementation of a recurring-authorization protocol on Stellar. Writes go through
            the SDK and your wallet; reads come from the indexer read API at {CONFIG.indexerUrl}.
          </p>
          <p className="muted small">
            {accountId === null ? "" : `Smart account: ${shortenAddress(accountId, 10, 6)}`}
          </p>
        </footer>
      </main>

      <div className="toast-stack" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast toast-${toast.kind}`}>
            <p className="toast-title">{toast.title}</p>
            {toast.detail !== undefined ? <p className="toast-detail mono">{toast.detail}</p> : null}
          </div>
        ))}
      </div>
    </div>
  );
}
