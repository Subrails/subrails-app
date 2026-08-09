import type { Metadata } from "next";

import "./globals.css";

import { loadWebConfig } from "@/lib/config";
import { WalletProvider } from "@/lib/wallet";

export const metadata: Metadata = {
  title: "Subrails \u00b7 recurring authorization on Stellar",
  description:
    "Reference implementation of the Subrails protocol: a subscriber sets on-chain limits on a smart account, and a merchant pulls recurring charges within them.",
};

export default function RootLayout(props: { children: React.ReactNode }): React.ReactElement {
  const config = loadWebConfig();
  return (
    <html lang="en">
      <body>
        <WalletProvider network={config.network} networkPassphrase={config.sdk.networkPassphrase}>
          {props.children}
        </WalletProvider>
      </body>
    </html>
  );
}
