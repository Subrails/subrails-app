"use client";

import { formatTokenAmount, formatLedger, shortenHash } from "@/lib/format";
import type { IndexerCharge } from "@/lib/indexer";
import { EmptyState } from "./ui";

export function ChargesTable(props: {
  charges: IndexerCharge[];
  decimals: number | null;
  symbol: string;
  explorerUrl?: string;
}): React.ReactElement {
  if (props.charges.length === 0) {
    return (
      <EmptyState title="No charges yet" body="Authorized charges appear here as the indexer ingests the mandate-policy events." />
    );
  }
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th>Ledger</th>
            <th>Amount</th>
            <th>Next valid</th>
            <th>Transaction</th>
          </tr>
        </thead>
        <tbody>
          {props.charges.map((charge) => {
            const amount = props.decimals === null ? charge.amount : formatTokenAmount(BigInt(charge.amount), props.decimals);
            const explorer = props.explorerUrl === undefined ? null : `${props.explorerUrl}${charge.txHash}`;
            return (
              <tr key={`${charge.txHash}-${charge.eventIndex}`}>
                <td className="mono">{formatLedger(charge.ledger)}</td>
                <td className="mono">
                  {amount} {props.symbol}
                </td>
                <td className="mono">{charge.nextValidLedger === null ? "\u2013" : formatLedger(BigInt(charge.nextValidLedger))}</td>
                <td className="mono">
                  {explorer === null ? (
                    shortenHash(charge.txHash)
                  ) : (
                    <a href={explorer} target="_blank" rel="noreferrer" className="tx-link">
                      {shortenHash(charge.txHash)}
                    </a>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
