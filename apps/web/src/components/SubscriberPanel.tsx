/**
 * The subscriber side of the reference flow: deploy a subrails-account smart
 * account for the connected wallet, fund it with the token, create a mandate
 * with on-chain limits, and register it on the account and in the registry.
 */

"use client";

import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";

import { Button, CopyButton, Field, Panel, Spinner } from "./ui";

import type { SdkConfig } from "@/lib/config";
import type { WebConfig as WebConfigType } from "@/lib/config";
import { errorMessage } from "@/lib/error-text";
import { formatLedger, formatTokenAmount, ledgerSpanLabel, shortenAddress, toBaseUnits } from "@/lib/format";
import { accountClient, policyClient, registryClient, tokenClient } from "@/lib/sdk-clients";
import { useWallet } from "@/lib/wallet";

export interface Toast {
  id: number;
  kind: "success" | "error" | "info";
  title: string;
  detail?: string;
}

export interface SubscriberPanelProps {
  config: WebConfigType;
  sdk: SdkConfig;
  accountId: string | null;
  currentLedger: number | null;
  tokenId: string;
  merchant: string;
  latestMandateId: bigint | null;
  onAccountDeployed: (accountId: string) => void;
  onTokenIdChange: (tokenId: string) => void;
  onMandateCreated: (mandateId: bigint) => void;
  pushToast: (kind: Toast["kind"], title: string, detail?: string) => void;
}

function Step(props: { index: number; title: string; children: ReactNode }): React.ReactElement {
  return (
    <section className="step">
      <h3 className="step-head">
        <span className="step-index">{props.index}</span>
        {props.title}
      </h3>
      <div className="step-body">{props.children}</div>
    </section>
  );
}

export function SubscriberPanel(props: SubscriberPanelProps): React.ReactElement {
  const { address, signerFor } = useWallet();
  const [busy, setBusy] = useState<string | null>(null);
  const [ownerBalance, setOwnerBalance] = useState<bigint | null>(null);
  const [accountBalance, setAccountBalance] = useState<bigint | null>(null);
  const [tokenMeta, setTokenMeta] = useState<{ symbol: string; decimals: number } | null>(null);
  const [fundAmount, setFundAmount] = useState("100");
  const [merchant, setMerchant] = useState(props.merchant);
  const [maxAmount, setMaxAmount] = useState("1");
  const [intervalLedgers, setIntervalLedgers] = useState("144");
  const [expiryLedgers, setExpiryLedgers] = useState("2880");

  const decimals = tokenMeta?.decimals ?? 7;
  const tokenSymbol = tokenMeta?.symbol ?? "token";

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

  const loadTokenMeta = useCallback(async () => {
    if (props.tokenId.trim().length === 0) {
      setTokenMeta(null);
      return;
    }
    try {
      const token = tokenClient(props.sdk, props.tokenId.trim());
      const [symbol, tokenDecimals] = await Promise.all([token.symbol(), token.decimals()]);
      setTokenMeta({ symbol, decimals: tokenDecimals });
    } catch {
      setTokenMeta(null);
    }
  }, [props.sdk, props.tokenId]);

  const refreshBalances = useCallback(async () => {
    if (props.tokenId.trim().length === 0) {
      return;
    }
    try {
      const token = tokenClient(props.sdk, props.tokenId.trim());
      if (address !== null) {
        setOwnerBalance(await token.balance(address));
      }
      if (props.accountId !== null) {
        setAccountBalance(await token.balance(props.accountId));
      }
    } catch {
      // Balance reads are best effort; the indexer is the source of truth.
    }
  }, [props.sdk, props.tokenId, props.accountId, address]);

  useEffect(() => {
    void loadTokenMeta();
  }, [loadTokenMeta]);

  useEffect(() => {
    void refreshBalances();
  }, [refreshBalances]);

  const canDeploy = props.config.contractsDeployed && props.config.accountWasmHash.length > 0 && address !== null;
  const canTransact = props.config.contractsDeployed && address !== null;

  const deployAccount = () =>
    void run("Deploy smart account", async () => {
      if (address === null || !canDeploy) {
        return;
      }
      const sub = accountClient(props.sdk);
      const signer = signerFor(address);
      const { accountId } = await sub.deployAccount(
        { owner: address, policyContract: props.config.policyId },
        { signer },
      );
      await sub.initialize({ accountId, owner: address, policyContract: props.config.policyId }, { signer });
      props.onAccountDeployed(accountId);
      props.pushToast("success", "Smart account deployed", shortenAddress(accountId, 8, 6));
    });

  const fundOwner = () =>
    void run("Fund owner via friendbot", async () => {
      if (address === null || props.sdk.network !== "testnet") {
        return;
      }
      const response = await fetch(`https://friendbot.stellar.org?addr=${encodeURIComponent(address)}`);
      if (!response.ok) {
        throw new Error(`Friendbot responded with status ${response.status}.`);
      }
      props.pushToast("success", "Owner funded with testnet XLM");
      await refreshBalances();
    });

  const fundAccount = () =>
    void run("Fund smart account", async () => {
      if (address === null || props.accountId === null || props.tokenId.trim() === "") {
        return;
      }
      const amount = toBaseUnits(fundAmount, decimals);
      const token = tokenClient(props.sdk, props.tokenId.trim());
      await token.transfer({ from: address, to: props.accountId, amount }, { signer: signerFor(address) });
      props.pushToast("success", "Smart account funded", `${formatTokenAmount(amount, decimals)} ${tokenSymbol}`);
      await refreshBalances();
    });

  const createMandate = () =>
    void run("Create mandate", async () => {
      if (address === null || props.accountId === null || props.tokenId.trim() === "") {
        return;
      }
      if (merchant.trim() === "") {
        props.pushToast("error", "Create mandate", "Enter a merchant address.");
        return;
      }
      const policy = policyClient(props.sdk);
      const ledger = props.currentLedger ?? (await policy.ledger());
      const { mandateId } = await policy.createMandate(
        {
          account: props.accountId,
          merchant: merchant.trim(),
          token: props.tokenId.trim(),
          maxAmount: toBaseUnits(maxAmount, decimals),
          intervalLedgers: Number(intervalLedgers),
          expiryLedger: ledger + Number(expiryLedgers),
        },
        { signer: signerFor(address) },
      );
      props.onMandateCreated(mandateId);
      props.pushToast("success", "Mandate created", `id ${mandateId}`);
    });

  const registerMandate = (mandateId: bigint) =>
    void run("Register mandate", async () => {
      if (address === null || props.accountId === null) {
        return;
      }
      const sub = accountClient(props.sdk);
      await sub.registerMandate({ accountId: props.accountId, mandateId }, { signer: signerFor(address) });
      props.pushToast("success", "Mandate registered on the smart account", `id ${mandateId}`);
    });

  const indexMandate = (mandateId: bigint) =>
    void run("Index mandate", async () => {
      if (address === null) {
        return;
      }
      const registry = registryClient(props.sdk);
      await registry.indexMandate(
        { mandateId, account: props.accountId ?? "", merchant },
        { signer: signerFor(address) },
      );
      props.pushToast("success", "Mandate indexed in the registry", `id ${mandateId}`);
    });

  const tokenHint = tokenMeta === null
    ? "A Soroban token contract id (C\u2026). Amounts are entered in base units until the token loads."
    : `Amounts are entered as ${tokenSymbol} and converted with ${decimals} decimals.`;

  return (
    <Panel
      title="Subscriber"
      kicker="The party that sets the limits"
      accent="violet"
      actions={address !== null ? <CopyButton text={address} label="subscriber address" /> : undefined}
    >
      <div className="stack">
        <Step index={1} title="Owner account">
          {address === null ? (
            <p className="muted">Connect a wallet to act as the account owner. The owner signs every subscriber action.</p>
          ) : (
            <div className="row-between">
              <div>
                <p className="mono addr">{shortenAddress(address, 10, 6)}</p>
                <p className="muted small">
                  {props.sdk.network === "testnet"
                    ? "Testnet XLM pays the transaction fees. Fund it once with friendbot."
                    : "This demo runs on testnet; funding is disabled here."}
                </p>
              </div>
              {props.sdk.network === "testnet" ? (
                <Button variant="ghost" onClick={fundOwner} loading={busy === "Fund owner via friendbot"} disabled={address === null}>
                  Fund with friendbot
                </Button>
              ) : null}
            </div>
          )}
        </Step>

        <Step index={2} title="Smart account">
          {props.accountId === null ? (
            <div>
              <p className="muted">
                Deploys a subrails-account contract owned by your wallet. The mandate-policy contract will act as its
                delegated signer, which is what lets a merchant charge without your per-charge signature.
              </p>
              <Button
                variant="primary"
                onClick={deployAccount}
                loading={busy === "Deploy smart account"}
                disabled={!canDeploy}
              >
                Deploy smart account
              </Button>
              {!props.config.contractsDeployed || props.config.accountWasmHash.length === 0 ? (
                <p className="warn small">
                  Deployment needs the contract ids and the subrails-account wasm hash from a contract deployment. See the
                  workspace .env.example.
                </p>
              ) : null}
            </div>
          ) : (
            <div className="stack">
              <div className="row-between">
                <div>
                  <p className="mono addr">{shortenAddress(props.accountId, 10, 6)}</p>
                  <p className="muted small">The smart account that holds funds and accepts charges.</p>
                </div>
                <CopyButton text={props.accountId} label="smart account id" />
              </div>

              <div className="grid-2">
                <Field
                  label="Token"
                  mono
                  inputProps={{
                    value: props.tokenId,
                    onChange: (event) => props.onTokenIdChange(event.target.value),
                    placeholder: "C\u2026 (Soroban token contract)",
                  }}
                />
                <div className="field">
                  <span className="field-label">Token meta</span>
                  <div className="field-value mono">
                    {tokenMeta === null ? <Spinner /> : `${tokenSymbol} \u00b7 ${decimals} decimals`}
                  </div>
                </div>
              </div>

              <div className="grid-2">
                <Field
                  label={`Fund smart account (${tokenSymbol})`}
                  hint={tokenHint}
                  inputProps={{
                    value: fundAmount,
                    onChange: (event) => setFundAmount(event.target.value),
                    inputMode: "decimal",
                  }}
                />
                <div className="field">
                  <span className="field-label">Smart account balance</span>
                  <div className="field-value mono">
                    {accountBalance === null ? "\u2013" : `${formatTokenAmount(accountBalance, decimals)} ${tokenSymbol}`}
                  </div>
                </div>
              </div>
              <Button
                variant="teal"
                onClick={fundAccount}
                loading={busy === "Fund smart account"}
                disabled={!canTransact || props.accountId === null || props.tokenId.trim() === ""}
              >
                Move tokens in
              </Button>
              {address !== null ? (
                <p className="muted small">Your wallet holds {ownerBalance === null ? "\u2013" : formatTokenAmount(ownerBalance, decimals)} {tokenSymbol}.</p>
              ) : null}
            </div>
          )}
        </Step>

        <Step index={3} title="Create mandate">
          {props.accountId === null ? (
            <p className="muted">Deploy the smart account first.</p>
          ) : (
            <div className="stack">
              <p className="muted">
                Grants {merchant.trim() === "" ? "a merchant" : shortenAddress(merchant, 8, 6)} the right to pull up to
                the max amount of {tokenSymbol}, at most once per interval, until the expiry ledger. These limits are
                enforced on chain by the mandate-policy contract.
              </p>
              <Field
                label="Merchant address"
                mono
                inputProps={{
                  value: merchant,
                  onChange: (event) => setMerchant(event.target.value),
                  placeholder: "G\u2026 (merchant account)",
                }}
              />
              <div className="grid-2">
                <Field
                  label="Max amount per charge"
                  hint={tokenHint}
                  inputProps={{ value: maxAmount, onChange: (event) => setMaxAmount(event.target.value), inputMode: "decimal" }}
                />
                <Field
                  label="Interval between charges"
                  hint={ledgerSpanLabel(Number(intervalLedgers) || 0)}
                  inputProps={{ value: intervalLedgers, onChange: (event) => setIntervalLedgers(event.target.value), inputMode: "numeric" }}
                />
              </div>
              <div className="grid-2">
                <Field
                  label="Valid for (ledgers from now)"
                  hint={ledgerSpanLabel(Number(expiryLedgers) || 0)}
                  inputProps={{ value: expiryLedgers, onChange: (event) => setExpiryLedgers(event.target.value), inputMode: "numeric" }}
                />
                <div className="field">
                  <span className="field-label">Expiry ledger</span>
                  <div className="field-value mono">
                    {props.currentLedger === null
                      ? "\u2013"
                      : formatLedger(props.currentLedger + (Number(expiryLedgers) || 0))}
                  </div>
                </div>
              </div>
              <Button
                variant="primary"
                onClick={createMandate}
                loading={busy === "Create mandate"}
                disabled={!canTransact || props.accountId === null || props.tokenId.trim() === ""}
              >
                Create mandate
              </Button>
            </div>
          )}
        </Step>

        <Step index={4} title="Register on chain">
          {props.accountId === null ? (
            <p className="muted">Create a mandate first.</p>
          ) : (
            <div className="stack">
              <p className="muted">
                Two registrations complete the setup. Registering on the smart account is required before any charge can
                run. Indexing in the registry needs the registry admin's key, so it may fail unless this wallet is the
                admin.
              </p>
              <div className="row-between">
                <div>
                  <p className="muted small">
                    Latest mandate: {props.latestMandateId === null ? "none yet" : `#${props.latestMandateId}`}
                  </p>
                </div>
                <div className="row-2">
                  <Button
                    variant="ghost"
                    onClick={() => props.latestMandateId !== null && registerMandate(props.latestMandateId)}
                    loading={busy === "Register mandate"}
                    disabled={!canTransact || props.latestMandateId === null}
                  >
                    Register mandate
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => props.latestMandateId !== null && indexMandate(props.latestMandateId)}
                    loading={busy === "Index mandate"}
                    disabled={!canTransact || props.latestMandateId === null}
                  >
                    Index in registry
                  </Button>
                </div>
              </div>
            </div>
          )}
        </Step>
      </div>
    </Panel>
  );
}
