-- Subrails indexer schema.
--
-- mandates: current state of each mandate (one row per mandate id, upserted
--   from mandate_created / charge_authorized / mandate_revoked /
--   mandate_expired events).
-- charges: every authorized charge, keyed by (tx_hash, event_index) so that
--   re-ingesting a ledger range can never duplicate a charge.
-- indexer_state: the last ledger whose events were fully ingested, so a
--   restart resumes cleanly from the ledger after it.

CREATE TABLE IF NOT EXISTS mandates (
    mandate_id        NUMERIC NOT NULL PRIMARY KEY,
    account           TEXT NOT NULL,
    merchant          TEXT NOT NULL,
    token             TEXT NOT NULL,
    max_amount        NUMERIC NOT NULL,
    interval_ledgers  INTEGER NOT NULL,
    next_valid_ledger BIGINT NOT NULL,
    expiry_ledger     BIGINT NOT NULL,
    status            TEXT NOT NULL CHECK (status IN ('Active', 'Revoked', 'Expired')),
    created_ledger    BIGINT NOT NULL,
    updated_ledger    BIGINT NOT NULL,
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mandates_account  ON mandates (account);
CREATE INDEX IF NOT EXISTS idx_mandates_merchant ON mandates (merchant);

CREATE TABLE IF NOT EXISTS charges (
    tx_hash           TEXT NOT NULL,
    event_index       INTEGER NOT NULL,
    mandate_id        NUMERIC NOT NULL,
    merchant          TEXT NOT NULL,
    token             TEXT NOT NULL,
    amount            NUMERIC NOT NULL,
    ledger            BIGINT NOT NULL,
    next_valid_ledger BIGINT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (tx_hash, event_index)
);

CREATE INDEX IF NOT EXISTS idx_charges_mandate_id ON charges (mandate_id);
CREATE INDEX IF NOT EXISTS idx_charges_ledger      ON charges (ledger);

CREATE TABLE IF NOT EXISTS indexer_state (
    id          INTEGER NOT NULL PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    last_ledger BIGINT NOT NULL,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
