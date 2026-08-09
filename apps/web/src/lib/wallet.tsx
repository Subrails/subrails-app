/**
 * Wallet connection through @creit.tech/stellar-wallets-kit (Freighter,
 * xBull, Albedo, Lobstr, Rabet, Hana). The kit signs transactions and
 * authorization entries on behalf of the wallet extension; the app never
 * sees a secret key and never hand-rolls signing.
 *
 * The kit exposes a static API, so this module wraps it in a React context
 * and adapts it to the SDK's {@link Signer} interface. The `address` option
 * on the kit's sign calls lets the demo sign with a specific account (for
 * example the merchant role) without switching the wallet's active account.
 */

"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

import {
  KitEventType,
  Networks,
  StellarWalletsKit,
} from "@creit.tech/stellar-wallets-kit";
import { AlbedoModule } from "@creit.tech/stellar-wallets-kit/modules/albedo";
import { FreighterModule, FREIGHTER_ID } from "@creit.tech/stellar-wallets-kit/modules/freighter";
import { HanaModule } from "@creit.tech/stellar-wallets-kit/modules/hana";
import { LobstrModule } from "@creit.tech/stellar-wallets-kit/modules/lobstr";
import { RabetModule } from "@creit.tech/stellar-wallets-kit/modules/rabet";
import { xBullModule } from "@creit.tech/stellar-wallets-kit/modules/xbull";

import type { Signer } from "@subrails/sdk";
import type { NetworkName } from "@subrails/sdk";

export interface WalletContextValue {
  /** The wallet account the user connected, or null. */
  address: string | null;
  /** True while the wallet modal is open or a connection is pending. */
  connecting: boolean;
  /** Opens the wallet picker and connects. */
  connect: () => Promise<void>;
  /** Disconnects the wallet and clears the active address. */
  disconnect: () => Promise<void>;
  /**
   * Builds an SDK {@link Signer} that signs with `address`. The wallet must
   * hold that account (or be asked to add it); the wallet extension prompts
   * on first use.
   */
  signerFor: (address: string) => Signer;
}

const WalletContext = createContext<WalletContextValue | null>(null);

/** Initializes the kit once per network. */
function initKit(network: NetworkName): void {
  StellarWalletsKit.init({
    modules: [
      new FreighterModule(),
      new xBullModule(),
      new AlbedoModule(),
      new LobstrModule(),
      new RabetModule(),
      new HanaModule(),
    ],
    selectedWalletId: FREIGHTER_ID,
    network: network === "mainnet" ? Networks.PUBLIC : Networks.TESTNET,
  });
}

export function WalletProvider(props: {
  network: NetworkName;
  networkPassphrase: string;
  children: ReactNode;
}): React.ReactElement {
  const [address, setAddress] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  useEffect(() => {
    initKit(props.network);
    const unsubscribe = StellarWalletsKit.on(KitEventType.STATE_UPDATED, (event) => {
      setAddress(event.payload.address ?? null);
    });
    return unsubscribe;
  }, [props.network]);

  const connect = useCallback(async () => {
    setConnecting(true);
    try {
      const { address: connected } = await StellarWalletsKit.authModal();
      setAddress(connected);
    } finally {
      setConnecting(false);
    }
  }, []);

  const disconnect = useCallback(async () => {
    await StellarWalletsKit.disconnect();
    setAddress(null);
  }, []);

  const signerFor = useCallback(
    (signingAddress: string): Signer => ({
      publicKey: signingAddress,
      async signTransaction(txXdr, opts) {
        const result = await StellarWalletsKit.signTransaction(txXdr, {
          networkPassphrase: opts?.networkPassphrase ?? props.networkPassphrase,
          address: signingAddress,
        });
        return { signedTxXdr: result.signedTxXdr, signerAddress: result.signerAddress };
      },
      async signAuthEntry(authEntryXdr, opts) {
        const result = await StellarWalletsKit.signAuthEntry(authEntryXdr, {
          networkPassphrase: opts?.networkPassphrase ?? props.networkPassphrase,
          address: signingAddress,
        });
        return { signedAuthEntry: result.signedAuthEntry, signerAddress: result.signerAddress };
      },
    }),
    [props.networkPassphrase],
  );

  const value = useMemo<WalletContextValue>(
    () => ({ address, connecting, connect, disconnect, signerFor }),
    [address, connecting, connect, disconnect, signerFor],
  );

  return <WalletContext.Provider value={value}>{props.children}</WalletContext.Provider>;
}

/** The wallet connection context; throws when used outside the provider. */
export function useWallet(): WalletContextValue {
  const value = useContext(WalletContext);
  if (value === null) {
    throw new Error("useWallet must be used inside WalletProvider.");
  }
  return value;
}
