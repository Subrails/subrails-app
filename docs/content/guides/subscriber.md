---
title: Subscriber guide
description: How to create a mandate, what the limits protect you from, and how to revoke, in plain language.
section: guides
eyebrow: Guide for subscribers
---

# You are the subscriber

This guide is for the person paying. It describes the demo in plain language: what a mandate is, what the limits protect you from, and how to revoke. No code required.

## The idea

A mandate is a standing instruction you give to one merchant, on the ledger: charge my account up to this amount, no more often than this interval, and never after this expiry. The merchant pulls each payment when it is due, and the protocol checks your limits on every single pull. The merchant does not need to ask you each time, and you do not need to sign each payment.

The four limits you set are the whole agreement:

- **Who:** one merchant only. No other party can charge your account.
- **How much:** a fixed maximum per charge. The merchant can charge you 10, never 11, never 10 twice in one interval.
- **How often:** a minimum interval between charges. The merchant cannot charge early.
- **Until when:** an expiry. After that, nothing more is taken, automatically.

## What protects you

- **No open allowance.** You never approve a spender to take an unlimited amount. The cap is a hard number, checked by the contract on every charge.
- **No key sharing.** Your wallet keys stay with you. The account that gets charged is a smart contract controlled by your wallet; nobody else holds anything of yours.
- **Revocation is immediate.** When you revoke, the state changes on the ledger. There is no "the merchant said they cancelled it" window, because the protocol stops authorizing charges the moment you revoke.
- **Expiry is automatic.** You do not need to remember to cancel. Once the ledger passes your expiry, a charge cannot authorize.

## In the demo

The [live demo](https://subrails-web-three.vercel.app/demo) runs on testnet with testnet tokens, so you can go through the whole flow freely:

1. **Connect your wallet.** Any Stellar wallet works. It signs what you approve and nothing else.
2. **Deploy your smart account.** The demo creates a fresh account contract for you, controlled by your wallet.
3. **Fund it.** Move some testnet tokens into the account so there is a balance to charge.
4. **Enter the token and the merchant.** The token is the contract id of the token you want to pay in. The merchant is the address of whoever you are authorizing.
5. **Create a mandate.** Pick the cap, the interval, and the expiry. Your wallet signs once. That is the last time you need to sign for this mandate.

After that, the merchant panel can charge against the mandate without you. You can watch the charges appear on the board.

## How to revoke

Revoke in the demo (or by calling the contract through the SDK): it takes one signed transaction, and it takes effect on the ledger immediately. After revocation, every further charge attempt is rejected by the contract. The pair of you can start a new mandate later if you change your mind; revocation removes the old one.

> [!warn] Only you can revoke
>
> The contract lets the account (you) revoke, and no one else. A merchant cannot cancel your mandate on their own. That is deliberate: it guarantees no one can end your authorization except you. If a merchant tells you a subscription is cancelled, check the mandate status yourself, and revoke if it is still active.

## What to check before trusting it

- This is testnet software, not audited, not for real money.
- Check the mandate status and expiry before relying on the demo: the board shows them from the indexer.
- Your wallet signs every state change you make, so you always see exactly what you are approving. Nothing happens to your account without a signature from you, except the charges the mandate itself authorizes.
