/**
 * The mandate board. All reads come from the indexer read API: the mandate
 * list (by account), the per-mandate charge history, and the indexer health
 * check. Revoking is the one write, and it goes through the SDK with the
 * owner's wallet.
 */

"use client";

import { useCallback, useEffect, useState } from "react";

import { ChargesTable } from "./ChargesTable";
import { Button, EmptyState, KvRow, Panel, Spinner, StatusChip } from "./ui";

import type { SdkConfig } from "@/lib/config";
import { errorMessage } from "@/lib/error-text";
import { formatLedger, formatTokenAmount, ledgerSpanLabel, shortenAddress } from "@/lib/format";
import { fetchIndexerHealth, fetchMandateDetail, fetchMandates } from "@/lib/indexer";
import type { IndexerCharge, IndexerMandate } from "@/lib/indexer";
import { policyClient } from "@/lib/sdk-clients";
import { useWallet } from "@/lib/wallet";

export interface MandateBoardProps {
  sdk: SdkConfig;
  indexerUrl: string;
  accountId: string | null;
  tokenDecimals: number | null;
  tokenSymbol: string;
  onIndexerStatusChange: (ok: boolean | null) => void;
  pushToast: (kind: "success" | "error" | "info", title: string, detail?: string) => void;
}

interface MandateView extends IndexerMandate {
  charges: IndexerCharge[];
}

const POLL_MS = 8_000;

export function MandateBoard(props: MandateBoardProps): React.ReactElement {
  const { address, signerFor } = useWallet();
  const [mandates, setMandates] = useState<MandateView[] | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    if (props.accountId === null) {
      setMandates(null);
      props.onIndexerStatusChange(null);
      return;
    }
    setRefreshing(true);
    try {
      const health = await fetchIndexerHealth(props.indexerUrl);
      props.onIndexerStatusChange(health.ok);
      if (!health.ok) {
        setMandates(null);
        return;
      }
      const listing = await fetchMandates(props.indexerUrl, { account: props.accountId });
      if (!listing.ok) {
        props.onIndexerStatusChange(false);
        setMandates(null);
        return;
      }
      const views: MandateView[] = [];
      for (const mandate of listing.data) {
        const detail = await fetchMandateDetail(props.indexerUrl, BigInt(mandate.mandateId));
        views.push({ ...mandate, charges: detail.ok ? detail.data.charges : [] });
      }
      setMandates(views);
    } finally {
      setRefreshing(false);
    }
  }, [props.indexerUrl, props.accountId, props.onIndexerStatusChange]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), POLL_MS);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const revoke = (mandateId: bigint) =>
    void (async () => {
      if (address === null) {
        return;
      }
      setRevoking(mandateId.toString());
      try {
        await policyClient(props.sdk).revokeMandate(mandateId, { signer: signerFor(address) });
        props.pushToast("success", "Mandate revoked", `id ${mandateId}`);
        await refresh();
      } catch (cause) {
        props.pushToast("error", "Revoke mandate", errorMessage(cause));
      } finally {
        setRevoking(null);
      }
    })();

  const decimals = props.tokenDecimals;
  const symbol = props.tokenSymbol;

  return (
    <Panel
      title="Mandates"
      kicker="State and charge history from the indexer"
      accent="violet"
      actions={
        <Button variant="ghost" onClick={() => void refresh()} loading={refreshing}>
          Refresh
        </Button>
      }
    >
      {props.accountId === null ? (
        <EmptyState
          title="No smart account yet"
          body="Deploy a smart account on the subscriber side, then mandates and their charge history appear here."
        />
      ) : mandates === null ? (
        <div className="board-loading">
          <Spinner />
          <span>Waiting on the indexer\u2026</span>
        </div>
      ) : mandates.length === 0 ? (
        <EmptyState
          title="No mandates for this account"
          body="The indexer has not recorded a mandate for this smart account yet. Create one on the subscriber side."
        />
      ) : (
        <div className="stack">
          {mandates.map((mandate) => {
            const maxAmount = decimals === null ? mandate.maxAmount : formatTokenAmount(BigInt(mandate.maxAmount), decimals);
            return (
              <article className="mandate-card" key={mandate.mandateId}>
                <header className="mandate-head">
                  <div className="mandate-title">
                    <h3 className="mandate-id">Mandate #{mandate.mandateId}</h3>
                    <StatusChip status={mandate.status} />
                  </div>
                  <div className="mandate-actions">
                    {mandate.status === "Active" && address !== null ? (
                      <Button
                        variant="danger"
                        onClick={() => void revoke(BigInt(mandate.mandateId))}
                        loading={revoking === mandate.mandateId}
                      >
                        Revoke
                      </Button>
                    ) : null}
                  </div>
                </header>

                <dl className="kv-grid">
                  <KvRow label="Account">
                    <span className="mono" title={mandate.account}>
                      {shortenAddress(mandate.account, 8, 6)}
                    </span>
                  </KvRow>
                  <KvRow label="Merchant">
                    <span className="mono" title={mandate.merchant}>
                      {shortenAddress(mandate.merchant, 8, 6)}
                    </span>
                  </KvRow>
                  <KvRow label="Token">
                    <span className="mono" title={mandate.token}>
                      {shortenAddress(mandate.token, 8, 6)}
                    </span>
                  </KvRow>
                  <KvRow label="Max per charge">
                    <span className="mono">
                      {maxAmount} {symbol}
                    </span>
                  </KvRow>
                  <KvRow label="Interval">
                    <span className="mono">{ledgerSpanLabel(mandate.intervalLedgers)}</span>
                  </KvRow>
                  <KvRow label="Next valid ledger">
                    <span className="mono">{formatLedger(BigInt(mandate.nextValidLedger))}</span>
                  </KvRow>
                  <KvRow label="Expiry ledger">
                    <span className="mono">{formatLedger(BigInt(mandate.expiryLedger))}</span>
                  </KvRow>
                  <KvRow label="Indexer ledger">
                    <span className="mono">{formatLedger(BigInt(mandate.updatedLedger))}</span>
                  </KvRow>
                </dl>

                <ChargesTable
                  charges={mandate.charges}
                  decimals={decimals}
                  symbol={symbol}
                  explorerUrl={
                    props.sdk.network === "testnet"
                      ? "https://testnet.stellar.expert/tx/"
                      : "https://stellar.expert/tx/"
                  }
                />
              </article>
            );
          })}
        </div>
      )}
    </Panel>
  );
}
