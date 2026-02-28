#!/usr/bin/env node
/**
 * Generate PoseidonT3.sol using circomlibjs.
 * Outputs the Solidity contract that implements Poseidon(2 inputs).
 */
import { buildPoseidonOpt as buildPoseidon } from "circomlibjs";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const poseidon = await buildPoseidon();
  // circomlibjs doesn't have a direct Solidity export,
  // so we use the poseidon-solidity approach.
  // The contract is a precompiled lookup table contract.
  // We'll generate it from the iden3 poseidon-solidity package.

  // Actually, the standard approach is to use the poseidon contract
  // from the circom/circomlibjs ecosystem. Let's generate from the
  // createCode function.

  // The circomlibjs package provides poseidonContract.createCode(t)
  // which returns the bytecode for a Poseidon contract with t inputs.
  const poseidonContract = await import("circomlibjs");

  // Generate bytecode for 2-input Poseidon (T3 = 2+1 = 3)
  const bytecode = poseidonContract.poseidonContract.createCode(2);
  const abi = poseidonContract.poseidonContract.generateABI(2);

  // createCode returns a hex string already (e.g., "0x38600c...")
  const bytecodeHex = bytecode.startsWith("0x") ? bytecode : "0x" + bytecode;

  const outDir = path.join(__dirname, "..", "src", "core");

  // Write bytecode to a file that the deploy script can read
  const bytecodeOutPath = path.join(outDir, "PoseidonT3Bytecode.txt");
  fs.writeFileSync(bytecodeOutPath, bytecodeHex);

  // Write ABI
  const abiOutPath = path.join(outDir, "PoseidonT3ABI.json");
  fs.writeFileSync(abiOutPath, JSON.stringify(abi, null, 2));

  console.log("PoseidonT3 bytecode written to:", bytecodeOutPath);
  console.log("PoseidonT3 ABI written to:", abiOutPath);
  console.log("Bytecode length:", bytecodeHex.length / 2, "bytes");
}

main().catch(console.error);
