import { ethers } from "ethers";
import { config } from "../config";
import * as fs from "fs";

// Chainalysis Sanctions Oracle ABI (minimal)
const SANCTIONS_ORACLE_ABI = [
  "function isSanctioned(address addr) external view returns (bool)",
];

export interface ScreeningResult {
  approved: boolean;
  riskScore: number;
  flags: string[];
}

// In-memory OFAC SDN list cache
let ofacAddresses: Set<string> | null = null;

function loadOfacList(): Set<string> {
  if (ofacAddresses) return ofacAddresses;

  ofacAddresses = new Set<string>();

  try {
    if (fs.existsSync(config.ofacListPath)) {
      const raw = fs.readFileSync(config.ofacListPath, "utf-8");
      const parsed = JSON.parse(raw);

      // Support both flat array and structured SDN list formats
      const addresses: string[] = Array.isArray(parsed)
        ? parsed
        : parsed.addresses ?? [];

      for (const addr of addresses) {
        if (typeof addr === "string" && ethers.isAddress(addr)) {
          ofacAddresses.add(addr.toLowerCase());
        }
      }

      console.log(
        `[Screening] Loaded ${ofacAddresses.size} addresses from local OFAC list`
      );
    } else {
      console.warn(
        `[Screening] OFAC list not found at ${config.ofacListPath}, local fallback disabled`
      );
    }
  } catch (err) {
    console.error("[Screening] Failed to load OFAC list:", err);
  }

  return ofacAddresses;
}

/**
 * Check address against Chainalysis Sanctions Oracle on-chain.
 * Returns true if the address is sanctioned.
 */
async function checkChainalysis(address: string): Promise<boolean> {
  try {
    const provider = new ethers.JsonRpcProvider(config.rpcUrl);
    const oracle = new ethers.Contract(
      config.chainalysisSanctionsOracle,
      SANCTIONS_ORACLE_ABI,
      provider
    );
    const isSanctioned: boolean = await oracle.isSanctioned(address);
    return isSanctioned;
  } catch (err) {
    console.error(
      "[Screening] Chainalysis oracle call failed, falling back to local list:",
      err instanceof Error ? err.message : err
    );
    // Signal that we should use fallback
    throw err;
  }
}

/**
 * Check address against local OFAC SDN list.
 */
function checkLocalOfac(address: string): boolean {
  const list = loadOfacList();
  return list.has(address.toLowerCase());
}

/**
 * Screen an address for sanctions and compliance.
 *
 * Primary: Chainalysis Sanctions Oracle (on-chain).
 * Fallback: Local OFAC SDN list.
 *
 * Risk scoring:
 *   0.0 = clean
 *   1.0 = sanctioned / blocked
 *   0.5 = oracle unreachable, passed local check (elevated caution)
 */
export async function checkAddress(address: string): Promise<ScreeningResult> {
  if (!ethers.isAddress(address)) {
    return {
      approved: false,
      riskScore: 1.0,
      flags: ["invalid_address"],
    };
  }

  const normalizedAddress = ethers.getAddress(address);
  const flags: string[] = [];
  let riskScore = 0.0;
  let oracleReachable = true;

  // Primary: Chainalysis on-chain oracle
  try {
    const sanctioned = await checkChainalysis(normalizedAddress);
    if (sanctioned) {
      flags.push("chainalysis_sanctioned");
      riskScore = 1.0;
      return { approved: false, riskScore, flags };
    }
  } catch {
    oracleReachable = false;
    flags.push("chainalysis_oracle_unreachable");
  }

  // Fallback / supplementary: local OFAC SDN list
  const onOfacList = checkLocalOfac(normalizedAddress);
  if (onOfacList) {
    flags.push("ofac_sdn_match");
    riskScore = 1.0;
    return { approved: false, riskScore, flags };
  }

  // If the oracle was unreachable, flag with elevated risk but still approve
  if (!oracleReachable) {
    riskScore = 0.5;
    flags.push("oracle_fallback_only");
  }

  return {
    approved: true,
    riskScore,
    flags,
  };
}

/**
 * Batch-screen multiple addresses. Returns a map of address -> result.
 */
export async function checkAddresses(
  addresses: string[]
): Promise<Map<string, ScreeningResult>> {
  const results = new Map<string, ScreeningResult>();
  // Process in parallel with concurrency limit
  const BATCH_SIZE = 10;

  for (let i = 0; i < addresses.length; i += BATCH_SIZE) {
    const batch = addresses.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.allSettled(
      batch.map((addr) => checkAddress(addr))
    );

    for (let j = 0; j < batch.length; j++) {
      const result = batchResults[j];
      if (result.status === "fulfilled") {
        results.set(batch[j], result.value);
      } else {
        results.set(batch[j], {
          approved: false,
          riskScore: 1.0,
          flags: ["screening_error", result.reason?.message ?? "unknown"],
        });
      }
    }
  }

  return results;
}
