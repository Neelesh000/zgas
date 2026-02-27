-- Privacy Paymaster Relayer Database Schema

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Tracked deposits from privacy pool contracts
CREATE TABLE IF NOT EXISTS deposits (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    commitment      VARCHAR(66) NOT NULL UNIQUE,
    leaf_index      INTEGER NOT NULL,
    depositor       VARCHAR(42),
    pool_address    VARCHAR(42) NOT NULL,
    token           VARCHAR(42),
    denomination    VARCHAR(78) NOT NULL,
    block_number    BIGINT NOT NULL,
    tx_hash         VARCHAR(66) NOT NULL UNIQUE,
    timestamp       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Screening results
    screening_status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (screening_status IN ('pending', 'approved', 'blocked')),
    risk_score      REAL,
    screening_flags TEXT[],
    screened_at     TIMESTAMPTZ,

    -- ASP inclusion
    asp_included    BOOLEAN NOT NULL DEFAULT FALSE,

    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_deposits_commitment ON deposits(commitment);
CREATE INDEX idx_deposits_pool ON deposits(pool_address);
CREATE INDEX idx_deposits_screening ON deposits(screening_status);
CREATE INDEX idx_deposits_asp ON deposits(asp_included);
CREATE INDEX idx_deposits_block ON deposits(block_number);

-- Queued and processed withdrawals
CREATE TABLE IF NOT EXISTS withdrawals (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    nullifier_hash      VARCHAR(66) NOT NULL UNIQUE,
    recipient           VARCHAR(42) NOT NULL,
    relayer_address     VARCHAR(42) NOT NULL,
    fee                 VARCHAR(78) NOT NULL,
    pool_address        VARCHAR(42) NOT NULL,

    -- Proof data (stored as hex)
    proof               TEXT NOT NULL,
    merkle_root         VARCHAR(66) NOT NULL,
    asp_root            VARCHAR(66) NOT NULL,
    refund              VARCHAR(78) NOT NULL DEFAULT '0',

    -- Processing state
    status              VARCHAR(20) NOT NULL DEFAULT 'queued'
        CHECK (status IN ('queued', 'processing', 'submitted', 'confirmed', 'failed', 'rejected')),
    scheduled_at        TIMESTAMPTZ NOT NULL,
    submitted_at        TIMESTAMPTZ,
    tx_hash             VARCHAR(66),
    block_number        BIGINT,
    gas_used            VARCHAR(78),
    error_message       TEXT,
    retry_count         INTEGER NOT NULL DEFAULT 0,

    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_withdrawals_nullifier ON withdrawals(nullifier_hash);
CREATE INDEX idx_withdrawals_status ON withdrawals(status);
CREATE INDEX idx_withdrawals_scheduled ON withdrawals(scheduled_at);
CREATE INDEX idx_withdrawals_recipient ON withdrawals(recipient);

-- Gas sponsorship records (ERC-4337 UserOps)
CREATE TABLE IF NOT EXISTS sponsorships (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    nullifier_hash      VARCHAR(66) NOT NULL UNIQUE,
    sender              VARCHAR(42) NOT NULL,
    user_op_hash        VARCHAR(66),
    paymaster_address   VARCHAR(42) NOT NULL,

    -- Gas details
    max_gas_cost        VARCHAR(78) NOT NULL,
    actual_gas_cost     VARCHAR(78),

    -- State
    status              VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'submitted', 'confirmed', 'failed', 'rejected')),
    tx_hash             VARCHAR(66),
    block_number        BIGINT,
    error_message       TEXT,

    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sponsorships_nullifier ON sponsorships(nullifier_hash);
CREATE INDEX idx_sponsorships_sender ON sponsorships(sender);
CREATE INDEX idx_sponsorships_status ON sponsorships(status);

-- ASP root history published on-chain
CREATE TABLE IF NOT EXISTS asp_roots (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    root            VARCHAR(66) NOT NULL UNIQUE,
    leaf_count      INTEGER NOT NULL,
    blocked_count   INTEGER NOT NULL DEFAULT 0,
    tx_hash         VARCHAR(66),
    block_number    BIGINT,
    status          VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'submitted', 'confirmed', 'failed')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_asp_roots_root ON asp_roots(root);
CREATE INDEX idx_asp_roots_status ON asp_roots(status);

-- Trigger to auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_deposits_updated_at
    BEFORE UPDATE ON deposits
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_withdrawals_updated_at
    BEFORE UPDATE ON withdrawals
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_sponsorships_updated_at
    BEFORE UPDATE ON sponsorships
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
