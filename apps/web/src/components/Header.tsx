"use client";

import Link from "next/link";

import { Button, CopyButton } from "./ui";

import { shortenAddress } from "@/lib/format";
import { useWallet } from "@/lib/wallet";
import type { NetworkName } from "@subrails/sdk";

export function Header(props: {
  network: NetworkName;
  indexerOk: boolean | null;
}): React.ReactElement {
  const { address, connecting, connect, disconnect } = useWallet();

  return (
    <header className="app-header">
      <div className="app-header-inner">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none">
              <path
                d="M12 2 20 7v10l-8 5-8-5V7l8-5Z"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinejoin="round"
              />
              <path d="M8.5 12.5l2.4 2.4 4.6-5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <span className="brand-name">Subrails</span>
          <span className="brand-sub">recurring authorization on Stellar</span>
        </div>

        <Link className="header-link" href="/">
          Home
        </Link>

        <div className="header-status">
          <span className={`net-chip ${props.network === "mainnet" ? "net-main" : "net-test"}`}>
            <span className="chip-dot" />
            {props.network}
          </span>
          <span
            className={`indexer-chip ${props.indexerOk === true ? "ok" : props.indexerOk === false ? "down" : ""}`}
            title="Indexer read API"
          >
            <span className="chip-dot" />
            {props.indexerOk === true ? "indexer online" : props.indexerOk === false ? "indexer down" : "indexer \u2026"}
          </span>
        </div>

        <div className="header-wallet">
          {address === null ? (
            <Button
              variant="primary"
              onClick={() => void connect().catch(() => undefined)}
              loading={connecting}
            >
              {connecting ? "Connecting" : "Connect wallet"}
            </Button>
          ) : (
            <div className="wallet-pill">
              <span className="wallet-dot" />
              <span className="mono wallet-address">{shortenAddress(address, 5, 4)}</span>
              <CopyButton text={address} label="wallet address" />
              <button type="button" className="wallet-disconnect" onClick={() => void disconnect()}>
                Disconnect
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
