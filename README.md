# ZGas - Privacy-Preserving Gas Sponsorship on BNB Chain

ZGas is a privacy-preserving ERC-4337 paymaster built on BNB Chain that enables users to deposit funds into privacy pools, withdraw anonymously using zero-knowledge proofs, and get gas sponsored for fresh wallets without revealing any on-chain identity. It combines Groth16 ZK proofs, Poseidon hashing, and account abstraction to break the link between a user's funded account and their destination wallet.

## Table of Contents

- [Why ZGas Exists](#why-zgas-exists)
- [How It Works](#how-it-works)
- [Use Cases](#use-cases)
- [Compliance Model](#compliance-model)
- [Architecture](#architecture)
- [Project Structure](#project-structure)
- [Setup and Installation](#setup-and-installation)
- [Local Development](#local-development)
- [Running the E2E Test](#running-the-e2e-test)
- [Circuit Details](#circuit-details)
- [Contract Details](#contract-details)
- [Security Model](#security-model)
- [Technology Stack](#technology-stack)

---

## Why ZGas Exists

When users onboard to blockchain through centralized exchanges, every withdrawal to a self-custody wallet creates a permanent, public link between their real-world identity (KYC on the exchange) and their on-chain activity. This means every DeFi interaction, NFT purchase, or token transfer is traceable back to the individual.

ZGas solves this by providing a mechanism where users can:

1. Deposit funds from a known wallet into a privacy pool.
2. Withdraw those same funds to a completely new wallet using a zero-knowledge proof that reveals nothing about the depositor.
3. Get gas sponsored on that new wallet so it can transact without needing to first receive funds from a traceable source.

The result is a clean wallet with funds and gas, with no on-chain link to the original depositor.

## How It Works

### Step 1: Deposit

A user selects a fixed denomination (e.g., 0.1 BNB) and deposits into a privacy pool. During deposit, the frontend generates a cryptographic note containing a secret and a nullifier, computes a Poseidon hash commitment, and submits it to the pool's on-chain Merkle tree. The user saves the note string -- this is the only way to later prove ownership.

### Step 2: Withdraw

When the user wants to withdraw, they paste their note into the frontend. The application reconstructs the pool's Merkle tree from on-chain Deposit events, generates a Groth16 zero-knowledge proof in the browser using snarkjs, and submits it to the smart contract. The proof demonstrates that the user knows a valid secret/nullifier pair corresponding to some commitment in the tree, without revealing which one. The contract verifies the proof on-chain using a Groth16 verifier, and sends the funds to the specified recipient address. A nullifier hash is recorded to prevent double-spending.

### Step 3: Gas Sponsorship

A user connects a brand-new wallet (zero balance) and provides their note. The frontend generates a separate membership proof using a domain-separated nullifier (Poseidon(nullifier, 2)) that proves pool membership without being linkable to the withdrawal proof. This proof is embedded in a UserOperation's paymasterAndData field. The ERC-4337 EntryPoint calls the PrivacyPaymaster, which verifies the membership proof on-chain and sponsors the gas. The fresh wallet can now execute transactions without ever receiving funds from a traceable source.

## Use Cases

### Privacy-Preserving Onboarding

Users who buy crypto on centralized exchanges can deposit into ZGas, withdraw to a fresh wallet, and begin using DeFi, NFTs, or any on-chain application without their exchange identity being linked to their activity.

### Salary and Payment Privacy

Organizations paying employees or contractors in crypto can route payments through ZGas so that individual compensation amounts and recipient identities are not publicly visible on-chain.

### Donation Privacy

Donors can contribute to causes without their identity or the amount being permanently recorded on a public ledger, while still maintaining compliance through the ASP system.

### Fresh Wallet Bootstrapping

New wallets typically need gas to make their first transaction, creating a chicken-and-egg problem. ZGas solves this by sponsoring gas for any wallet that can prove pool membership, without requiring a prior funding transaction.

### MEV Protection

Traders can use fresh wallets for each transaction, making it impossible for MEV bots to build a profile of their trading patterns across multiple transactions.

## Compliance Model

ZGas implements the Association Set Provider (ASP) model inspired by Oxbow and Privacy Pools research (Buterin et al., 2023). This provides a framework for privacy that is compatible with regulatory requirements.

### How ASP Compliance Works

1. **Deposit Screening**: When a user deposits, the ASP operator screens the depositor's address against sanctions lists (OFAC, Chainalysis, etc.).
2. **Approved Set**: Approved commitments are added to a separate ASP Merkle tree maintained by the registry operator.
3. **Dual Proof Requirement**: Every withdrawal requires two Merkle proofs -- one proving the commitment exists in the pool tree, and another proving it exists in the ASP-approved tree. Both are verified inside the same ZK circuit.
4. **Blocking**: If a commitment is later found to be associated with illicit activity, the ASP operator can remove it from the approved set. Future withdrawals for that commitment will fail because the ASP Merkle proof will no longer be valid.
5. **Regulatory Transparency**: Regulators can verify that the ASP is properly maintaining the approved set without needing to break the privacy of any individual user.

This design means that compliant users retain full privacy, while the system can exclude sanctioned or illicit funds -- satisfying both privacy advocates and regulatory requirements.

## Architecture

```
                        +------------------+
                        |    Frontend      |
                        |  (Next.js 14)    |
                        |                  |
                        |  - Deposit form  |
                        |  - Withdraw form |
                        |  - Sponsor form  |
                        |  - snarkjs proof |
                        |    generation    |
                        +--------+---------+
                                 |
                    +------------+------------+
                    |                         |
           +--------v--------+      +--------v--------+
           |  Devnet Relayer  |      |  Direct On-Chain |
           |  (Express.js)   |      |  (via Wallet)    |
           |                 |      |                  |
           | - /api/withdraw |      +--------+---------+
           | - /api/sponsor  |               |
           | - /api/asp/sync |               |
           +--------+--------+               |
                    |                        |
                    +------------+-----------+
                                 |
                    +------------v------------+
                    |      BNB Chain          |
                    |                         |
                    |  +------------------+   |
                    |  | PrivacyPool      |   |
                    |  | (Poseidon Merkle)|   |
                    |  +------------------+   |
                    |  +------------------+   |
                    |  | ASPRegistry      |   |
                    |  | (Compliance)     |   |
                    |  +------------------+   |
                    |  +------------------+   |
                    |  | Groth16 Verifier |   |
                    |  | (On-chain proof  |   |
                    |  |  verification)   |   |
                    |  +------------------+   |
                    |  +------------------+   |
                    |  | PrivacyPaymaster |   |
                    |  | (ERC-4337 gas    |   |
                    |  |  sponsorship)    |   |
                    |  +------------------+   |
                    |  +------------------+   |
                    |  | EntryPoint v0.7  |   |
                    |  | (Account         |   |
                    |  |  Abstraction)    |   |
                    |  +------------------+   |
                    +-------------------------+
```

## Project Structure

This is a monorepo managed with Yarn workspaces and Turborepo.

```
zgas/
├── packages/
│   ├── circuits/          Circom 2.1.6 ZK circuits
│   │   ├── circuits/
│   │   │   ├── withdraw.circom       Withdrawal proof (7 public inputs)
│   │   │   ├── membership.circom     Membership proof (3 public inputs)
│   │   │   └── lib/
│   │   │       └── merkleTree.circom Merkle tree verification templates
│   │   └── scripts/
│   │       └── build.sh              Circuit compilation + trusted setup
│   │
│   ├── contracts/         Foundry (Solidity 0.8.28)
│   │   ├── src/
│   │   │   ├── core/
│   │   │   │   ├── PrivacyPool.sol           BNB deposit/withdraw pool
│   │   │   │   ├── TokenPool.sol             ERC-20 deposit/withdraw pool
│   │   │   │   ├── MerkleTreeWithHistory.sol Incremental Merkle tree (depth 20)
│   │   │   │   └── PoseidonHasher.sol        On-chain Poseidon via staticcall
│   │   │   ├── compliance/
│   │   │   │   └── ASPRegistry.sol           Association Set Provider registry
│   │   │   ├── paymaster/
│   │   │   │   └── PrivacyPaymaster.sol      ERC-4337 gas sponsor with ZK proof
│   │   │   ├── verifiers/
│   │   │   │   ├── WithdrawGroth16Verifier.sol   Generated Groth16 verifier
│   │   │   │   ├── MembershipGroth16Verifier.sol Generated Groth16 verifier
│   │   │   │   ├── WithdrawVerifier.sol          IVerifier adapter
│   │   │   │   └── MembershipVerifier.sol        IVerifier adapter
│   │   │   ├── interfaces/
│   │   │   │   ├── IHasher.sol
│   │   │   │   ├── IVerifier.sol
│   │   │   │   └── IASPRegistry.sol
│   │   │   └── libraries/
│   │   │       └── Denomination.sol          Fixed denomination constants
│   │   ├── test/                             28 Foundry tests
│   │   └── script/
│   │       └── DeployLocal.s.sol             Local Anvil deployment
│   │
│   ├── frontend/          Next.js 14 (App Router)
│   │   ├── src/
│   │   │   ├── app/                          Pages: deposit, withdraw, sponsor, stats
│   │   │   ├── components/                   DepositForm, WithdrawForm, SponsorForm
│   │   │   ├── hooks/
│   │   │   │   ├── usePrivacyPool.ts         Deposit, withdraw, note generation
│   │   │   │   └── usePaymaster.ts           ERC-4337 UserOp construction
│   │   │   └── lib/
│   │   │       ├── poseidon.ts               Cached Poseidon hash functions
│   │   │       ├── merkleTree.ts             Client-side Merkle tree reconstruction
│   │   │       └── constants.ts              Contract addresses, ABIs, config
│   │   └── public/circuits/                  WASM + zkey circuit artifacts
│   │
│   ├── relayer/           Express.js backend
│   │   └── src/
│   │       └── devnet.ts                     Lightweight local relayer + ASP sync
│   │
│   └── sdk/               TypeScript SDK
│       └── src/
│           ├── client.ts                     Main client interface
│           ├── deposit.ts                    Deposit logic
│           ├── withdraw.ts                   Withdrawal + proof generation
│           ├── sponsor.ts                    Gas sponsorship logic
│           ├── merkle.ts                     Merkle tree utilities
│           └── note.ts                       Note (secret + nullifier) handling
│
├── e2e-test.mjs           End-to-end test script
├── package.json           Workspace root
└── turbo.json             Build orchestration
```

## Setup and Installation

### Prerequisites

- Node.js >= 18
- Yarn (v1)
- Foundry (forge, anvil, cast) -- install via https://getfoundry.sh
- Circom 2.1.6 -- install via https://docs.circom.io/getting-started/installation/

### Install Dependencies

```bash
git clone https://github.com/Neelesh000/zgas.git
cd zgas
yarn install
```

### Build Circuits

The circuits must be compiled before the system can generate real ZK proofs.

```bash
cd packages/circuits
npm run build
```

This produces WASM and zkey files for both the withdraw and membership circuits. The build script handles compilation, witness generation setup, and a development trusted setup (powers of tau ceremony).

### Copy Circuit Artifacts to Frontend

```bash
mkdir -p packages/frontend/public/circuits
cp packages/circuits/build/withdraw/withdraw_js/withdraw.wasm packages/frontend/public/circuits/
cp packages/circuits/build/withdraw/withdraw_final.zkey packages/frontend/public/circuits/
cp packages/circuits/build/membership/membership_js/membership.wasm packages/frontend/public/circuits/
cp packages/circuits/build/membership/membership_final.zkey packages/frontend/public/circuits/
```

### Build Contracts

```bash
cd packages/contracts
forge build
```

### Run Contract Tests

```bash
cd packages/contracts
forge test
```

All 28 tests should pass, covering MerkleTreeWithHistory (9 tests), PrivacyPool (11 tests), and ASPRegistry (8 tests).

## Local Development

### 1. Start Local Blockchain

```bash
anvil --chain-id 97 --block-time 1
```

### 2. Deploy Contracts

```bash
cd packages/contracts
forge script script/DeployLocal.s.sol \
  --rpc-url http://127.0.0.1:8545 \
  --broadcast \
  --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
```

This deploys the full system: PoseidonT3, PoseidonHasher, Groth16 verifiers (withdraw + membership), three BNB privacy pools (0.1, 1, 10 BNB), ASPRegistry, EntryPoint, SimpleAccountFactory, and PrivacyPaymaster. The paymaster is prefunded with 10 ETH at the EntryPoint.

Set `USE_MOCKS=true` to deploy with MockHasher and MockVerifier instead of real Poseidon/Groth16 for faster iteration.

### 3. Start the Relayer

```bash
cd packages/relayer
npx ts-node src/devnet.ts
```

The devnet relayer provides three endpoints:
- `POST /api/withdraw` -- submit a withdrawal transaction
- `POST /api/sponsor` -- submit a sponsored ERC-4337 UserOperation
- `POST /api/asp/sync` -- sync the ASP Merkle tree from all pool deposits and update the on-chain ASP root

### 4. Start the Frontend

```bash
cd packages/frontend
npm run dev
```

Open http://localhost:3000 in your browser.

### 5. Configure MetaMask

- Network: Custom RPC
- RPC URL: http://127.0.0.1:8545
- Chain ID: 97
- Import Anvil account #0: private key `0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80`

### Testing the Flow

1. Go to `/deposit`, select 0.1 BNB, and submit the deposit. Save the note string that appears.
2. Go to `/withdraw`, paste the note, enter a recipient address, and click "Generate ZK Proof". The browser will generate a real Groth16 proof (takes 5-10 seconds). Then click "Submit Withdrawal".
3. Go to `/sponsor`, paste a note (from a different deposit), enter a target contract and calldata, and submit. The paymaster will sponsor the gas.

## Running the E2E Test

The E2E test verifies the entire system without the frontend, using direct RPC calls:

```bash
# Ensure Anvil is running and contracts are deployed
node e2e-test.mjs
```

This test covers:
- Poseidon commitment generation and on-chain deposit
- Merkle tree reconstruction from Deposit events
- Real ASP tree construction and on-chain root update
- Groth16 proof generation and local verification
- On-chain withdrawal with proof verification (~319k gas)
- Double-spend prevention (nullifier reuse rejected)
- Membership proof generation with domain-separated nullifiers

## Circuit Details

### Withdraw Circuit (withdraw.circom)

7 public inputs: root, nullifierHash, recipient, relayer, fee, refund, aspRoot

The circuit proves:
- The prover knows secret and nullifier such that Poseidon(secret, nullifier) = commitment
- The commitment exists in the pool Merkle tree (verified against root)
- The commitment exists in the ASP-approved tree (verified against aspRoot)
- The nullifierHash equals Poseidon(nullifier)
- All values are within the BN128 scalar field (248-bit range checks)

### Membership Circuit (membership.circom)

3 public inputs: root, nullifierHash, aspRoot

The circuit proves the same Merkle membership as the withdraw circuit, but with a domain-separated nullifier: nullifierHash = Poseidon(nullifier, 2). This ensures that the membership nullifier cannot be correlated with the withdrawal nullifier from the same note, and vice versa.

## Contract Details

### PrivacyPool.sol

Fixed-denomination BNB privacy pool. Deposits add a Poseidon commitment to an incremental Merkle tree (depth 20, 30-root history). Withdrawals require a valid Groth16 proof verified by the on-chain WithdrawVerifier. The contract checks: commitment existence, nullifier uniqueness, Merkle root validity, ASP root validity (via ASPRegistry), and proof correctness.

### ASPRegistry.sol

Maintains a separate Merkle tree of approved commitments. The owner (ASP operator) can update the root as new deposits are screened and approved, or block specific commitments found to be associated with illicit activity. Uses the same 30-root history as the pool for consistency.

### PrivacyPaymaster.sol

An ERC-4337 BasePaymaster that validates membership proofs in the `_validatePaymasterUserOp` function. It decodes the proof, Merkle root, nullifier hash, and ASP root from the UserOperation's paymasterAndData field. It verifies the Groth16 membership proof on-chain via the MembershipVerifier, checks that the sponsorship nullifier has not been used before, and if valid, agrees to sponsor the gas.

### MerkleTreeWithHistory.sol

Incremental Merkle tree with Poseidon hashing via the IHasher interface. Depth 20 supports over 1 million deposits. Maintains a circular buffer of the last 30 roots, allowing withdrawals to reference a recent root even if new deposits have occurred between proof generation and submission.

## Security Model

### Privacy Guarantees

- **Fixed denominations** prevent amount correlation between deposits and withdrawals.
- **Poseidon hashing** (ZK-friendly hash function) enables efficient in-circuit Merkle proofs.
- **Domain-separated nullifiers** ensure withdrawal and sponsorship proofs from the same note cannot be linked.
- **Shared relayer wallet** prevents gas fingerprinting when using the relayer for withdrawals.

### On-Chain Security

- Checks-effects-interactions pattern in all fund transfers.
- Nullifier is checked before proof verification to save gas on double-spend attempts.
- 30-root history prevents front-running attacks where a new deposit changes the root between proof generation and submission.
- Fee-on-transfer tokens are explicitly rejected in TokenPool to prevent accounting exploits.
- All contracts are non-upgradeable (no proxy pattern).

### Circuit Security

- Public inputs are squared inside the circuit to bind them to the proof, preventing malleability.
- 248-bit range checks on secret and nullifier prevent overflow attacks in the BN128 scalar field.
- Separate circuits for withdrawal and membership prevent proof reuse across different operations.

## Technology Stack

| Layer | Technology |
|-------|-----------|
| Smart Contracts | Solidity 0.8.28, Foundry |
| ZK Circuits | Circom 2.1.6, snarkjs (Groth16) |
| On-Chain Hashing | Poseidon (circomlibjs-generated) |
| Account Abstraction | ERC-4337, EntryPoint v0.7 |
| Frontend | Next.js 14, wagmi v2, RainbowKit, Tailwind CSS |
| Relayer | Express.js, ethers v6 |
| SDK | TypeScript, ethers v6, snarkjs |
| Local Chain | Anvil (Foundry) |
| Build System | Yarn workspaces, Turborepo |

## License

MIT
