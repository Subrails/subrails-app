/**
 * The merchant side of the reference flow: pick the merchant account and
 * trigger a charge. The charge transaction is submitted by the merchant and
 * signed by their wallet; the smart account's authorization is satisfied by
 * the CAP-71 delegation to the mandate-policy contract, so the subscriber
 * never signs anything here.
 */

"use client";

import { useCallback, useEffect, useState } from "react";

import { Button, CopyButton, Field, Panel } from "./ui";

import type { SdkConfig, WebConfig } from "@/lib/config";
import { errorMessage } from "@/lib/error-text";
import { formatLedger, formatTokenAmount, shortenAddress, toBaseUnits } from "@/lib/format";
import { tokenClient } from "@/lib/sdk-clients";
import { useWallet } from "@/lib/wallet";
import { charge } from "@subrails/sdk";

export interface MerchantPanelProps {
  config: WebConfig;
  sdk: SdkConfig;
  accountId: string | null;
  currentLedger: number | null;
  tokenId: string;
  merchant: string;
  latestMandateId: bigint | null;
  onMerchantChange: (merchant: string) => void;
  onCharged: () => void;
  pushToast: (kind: "success" | "error" | "info", title: string, detail?: string) => void;
}

export function MerchantPanel(props: MerchantPanelProps): React.ReactElement {
  const { address, signerFor } = useWallet();
  const [busy, setBusy] = useState<string | null>(null);
  const [amount, setAmount] = useState("0.5");
  const [merchantBalance, setMerchantBalance] = useState<bigint | null>(null);
  const [tokenMeta, setTokenMeta] = useState<{ symbol: string; decimals: number } | null>(null);

  const decimals = tokenMeta?.decimals ?? 7;
  const tokenSymbol = tokenMeta?.symbol ?? "token";

  useEffect(() => {
    let cancelled = false;
    async function load(): Promise<void> {
      if (props.tokenId.trim() === "") {
        return;
      }
      try {
        const token = tokenClient(props.sdk, props.tokenId.trim());
        const [symbol, tokenDecimals] = await Promise.all([token.symbol(), token.decimals()]);
        if (!cancelled) {
          setTokenMeta({ symbol, decimals: tokenDecimals });
        }
        if (props.merchant.trim() !== "") {
          const balance = await token.balance(props.merchant.trim());
          if (!cancelled) {
            setMerchantBalance(balance);
          }
        }
      } catch {
        // Best effort reads.
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [props.sdk, props.tokenId, props.merchant]);

  const run = useCallback(
    async (name: string, fn: () => Promise<void>) => {
      setBusy(name);
      try {
        await fn();
      } catch (cause) {
        props.pushToast("error", name, errorMessage(cause));
      } finally {
        setBusy(null);
      }
    },
    [props],
  );

  const triggerCharge = () =>
    void run("Trigger charge", async () => {
      if (props.accountId === null || props.tokenId.trim() === "" || props.latestMandateId === null) {
        return;
      }
      if (props.merchant.trim() === "") {
        props.pushToast("error", "Trigger charge", "Enter a merchant address.");
        return;
      }
      const result = await charge({
        config: props.sdk,
        token: props.tokenId.trim(),
        subrailsAccount: props.accountId,
        merchant: props.merchant.trim(),
        amount: toBaseUnits(amount, decimals),
        mandateId: props.latestMandateId,
        signer: signerFor(props.merchant.trim()),
      });
      props.pushToast(
        "success",
        "Charge authorized",
        `${formatTokenAmount(result.amount, decimals)} ${tokenSymbol} on ledger ${result.ledger ?? "\u2026"}`,
      );
      props.onCharged();
    });

  const canCharge =
    props.config.contractsDeployed &&
    props.accountId !== null &&
    props.tokenId.trim() !== "" &&
    props.latestMandateId !== null &&
    props.merchant.trim() !== "" &&
    props.sdk.protocol27;

  return (
    <Panel
      title="Merchant"
      kicker="The party that pulls the charges"
      accent="teal"
      actions={props.merchant.trim() !== "" ? <CopyButton text={props.merchant.trim()} label="merchant address" /> : undefined}
    >
      <div className="stack">
        <Field
          label="Merchant account"
          mono
          hint="The wallet must hold this account. Freighter asks to add it on first use."
          inputProps={{
            value: props.merchant,
            onChange: (event) => props.onMerchantChange(event.target.value),
            placeholder: "G\u2026 (merchant account)",
          }}
        />
        {address !== null && props.merchant !== address ? (
          <button type="button" className="link-btn" onClick={() => props.onMerchantChange(address)}>
            Use the connected account ({shortenAddress(address, 6, 4)}) as the merchant
          </button>
        ) : null}

        <div className="grid-2">
          <Field
            label={`Charge amount (${tokenSymbol})`}
            hint={tokenMeta === null ? "Entered in base units until the token loads." : `${decimals} decimals`}
            inputProps={{ value: amount, onChange: (event) => setAmount(event.target.value), inputMode: "decimal" }}
          />
          <div className="field">
            <span className="field-label">Merchant balance</span>
            <div className="field-value mono">
              {merchantBalance === null ? "\u2013" : `${formatTokenAmount(merchantBalance, decimals)} ${tokenSymbol}`}
            </div>
          </div>
        </div>

        {props.latestMandateId === null ? (
          <p className="warn small">Create a mandate on the subscriber side first.</p>
        ) : (
          <p className="muted small">
            Charges run against mandate #{props.latestMandateId}. The on-chain limit check (max amount, interval,
            expiry) happens during authorization, before any token moves.
            {props.currentLedger !== null ? ` Current ledger: ${formatLedger(props.currentLedger)}.` : ""}
          </p>
        )}

        <Button variant="teal" onClick={triggerCharge} loading={busy === "Trigger charge"} disabled={!canCharge}>
          Trigger charge
        </Button>
        {!props.sdk.protocol27 ? (
          <p className="warn small">
            CAP-71 delegated authorization is off for this network. Delegated charges need Protocol 27.
          </p>
        ) : null}
      </div>
    </Panel>
  );
}
