# Privacy Paymaster Architecture

## Overview

A privacy-preserving ERC-4337 paymaster on BNB Chain that sponsors user transactions while mixing funds in a privacy pool, breaking the on-chain link between KYC exchange accounts and fresh wallets.

## System Architecture

```
┌─────────────┐     ┌──────────────┐     ┌─────────────────┐
│  Frontend    │────▶│   Relayer    │────▶│  BNB Chain      │
│  (Next.js)  │     │  (Express)   │     │                 │
└─────────────┘     └──────────────┘     │  ┌───────────┐  │
       │                   │              │  │PrivacyPool│  │
       │                   │              │  ├───────────┤  │
       ▼                   ▼              │  │ TokenPool │  │
┌─────────────┐     ┌──────────────┐     │  ├───────────┤  │
│   SDK       │     │  ASP Service │     │  │ASPRegistry│  │
│(snarkjs+    │     │  (Screening) │     │  ├───────────┤  │
│ Poseidon)   │     └──────────────┘     │  │ Paymaster │  │
└─────────────┘                          │  └───────────┘  │
                                         └─────────────────┘
```

## Flow

### Deposit Flow
1. User generates secret + nullifier client-side
2. Computes commitment = Poseidon(secret, nullifier)
3. Sends deposit TX with commitment + fixed denomination
4. ASP service screens depositor address
5. If approved, commitment added to ASP Merkle tree

### Withdrawal Flow
1. User provides note (secret + nullifier)
2. SDK fetches Merkle proofs (pool + ASP) from relayer
3. Generates Groth16 ZK proof in browser (snarkjs WASM)
4. Submits to relayer → relayer queues with random delay
5. Relayer submits from shared hot wallet → funds sent to recipient

### Gas Sponsorship Flow
1. Fresh wallet generates membership proof (domain-separated nullifier)
2. Constructs UserOp with paymaster data containing proof
3. Paymaster validates proof on-chain
4. EntryPoint executes UserOp, paymaster pays gas

## Security Model

### Privacy Guarantees
- **Timing analysis**: Randomized withdrawal delays (30s-15min)
- **Amount correlation**: Fixed denominations only
- **Gas fingerprinting**: Shared hot wallet + paymaster sponsorship
- **Graph analysis**: ASP set provides plausible deniability

### Compliance (Oxbow-style ASP)
- Deposits screened against sanctions lists (Chainalysis/OFAC)
- Users prove funds are in approved set via dual Merkle proof
- Blocked commitments cannot generate valid ASP proofs
- Regulators can verify compliance without breaking privacy

### Contract Security
- Checks-effects-interactions pattern
- Nullifier checked before proof verification (saves gas)
- 30-root history prevents front-running
- Immutable contracts (no proxy)
- Fee-on-transfer token rejection

### Circuit Security
- Public inputs squared to bind to proof
- 248-bit range checks on secrets
- Domain-separated nullifiers (withdraw vs sponsor)

## Contract Addresses

### Pools (9 total)
| Token | Denomination | Contract |
|-------|-------------|----------|
| BNB   | 0.1 BNB     | TBD      |
| BNB   | 1 BNB       | TBD      |
| BNB   | 10 BNB      | TBD      |
| USDT  | 100          | TBD      |
| USDT  | 1,000        | TBD      |
| USDT  | 10,000       | TBD      |
| USDC  | 100          | TBD      |
| USDC  | 1,000        | TBD      |
| USDC  | 10,000       | TBD      |

## Deployment

See `packages/contracts/script/` for deployment scripts.

### Testnet
```bash
forge script script/DeployTestnet.s.sol --rpc-url $TESTNET_RPC_URL --broadcast
```

### Mainnet
```bash
forge script script/Deploy.s.sol --rpc-url $RPC_URL --broadcast --verify
```
