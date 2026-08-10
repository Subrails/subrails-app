import type { Metadata } from "next";

import "./globals.css";

import { loadWebConfig } from "@/lib/config";
import { WalletProvider } from "@/lib/wallet";

export const metadata: Metadata = {
  title: "Subrails \u00b7 recurring authorization on Stellar",
  description:
    "Crypto has no direct debit; Subrails is the missing rail. A subscriber authorizes a merchant once, on chain, with hard limits: a maximum per charge, a fixed interval, an expiry. Built on Stellar Protocol 27 delegation.",
};

export default function RootLayout(props: { children: React.ReactNode }): React.ReactElement {
  const config = loadWebConfig();
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600&family=Archivo:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <WalletProvider network={config.network} networkPassphrase={config.sdk.networkPassphrase}>
          {props.children}
        </WalletProvider>
      </body>
    </html>
  );
}
