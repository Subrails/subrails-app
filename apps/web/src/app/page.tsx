"use client";

import { Header } from "@/components/Header";

import { loadWebConfig } from "@/lib/config";

const CONFIG = loadWebConfig();

export default function Page(): React.ReactElement {
  return (
    <div className="page">
      <Header network={CONFIG.network} indexerOk={null} currentLedger={null} />
      <main className="page-inner">
        <section className="hero">
          <h1 className="hero-title">Recurring payments with hard on-chain limits</h1>
          <p className="hero-sub">
            The reference flow follows in the next step: subscriber, merchant, and the mandate board.
          </p>
        </section>
      </main>
    </div>
  );
}
