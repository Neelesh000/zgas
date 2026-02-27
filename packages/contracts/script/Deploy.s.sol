// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {MerkleTreeWithHistory} from "../src/core/MerkleTreeWithHistory.sol";
import {PrivacyPool} from "../src/core/PrivacyPool.sol";
import {TokenPool} from "../src/core/TokenPool.sol";
import {ASPRegistry} from "../src/compliance/ASPRegistry.sol";
import {PrivacyPaymaster} from "../src/paymaster/PrivacyPaymaster.sol";
import {IHasher} from "../src/interfaces/IHasher.sol";
import {IVerifier} from "../src/interfaces/IVerifier.sol";
import {IASPRegistry} from "../src/interfaces/IASPRegistry.sol";
import {IEntryPoint} from "account-abstraction/interfaces/IEntryPoint.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title Deploy
/// @notice Deployment script for the full Privacy Paymaster stack on BNB Chain.
contract Deploy is Script {
    address constant ENTRYPOINT = 0x0000000071727De22E5E9d8BAf0edAc6f37da032;

    uint256 constant BNB_01 = 0.1 ether;
    uint256 constant BNB_1 = 1 ether;
    uint256 constant BNB_10 = 10 ether;
    uint256 constant STABLE_100 = 100 * 1e18;
    uint256 constant STABLE_1000 = 1_000 * 1e18;
    uint256 constant STABLE_10000 = 10_000 * 1e18;

    function _deployTokenPools(
        IHasher hasher,
        IVerifier verifier,
        IASPRegistry asp,
        address tokenAddr
    ) internal returns (address[3] memory pools) {
        uint256[3] memory denoms = [STABLE_100, STABLE_1000, STABLE_10000];
        for (uint256 i = 0; i < 3; i++) {
            TokenPool pool = new TokenPool(hasher, verifier, asp, IERC20(tokenAddr), denoms[i]);
            pools[i] = address(pool);
            console2.log("Token Pool", denoms[i] / 1e18, ":", address(pool));
        }
    }

    function run() external {
        address deployer = vm.envAddress("DEPLOYER_ADDRESS");
        IHasher hasher = IHasher(vm.envAddress("HASHER_ADDRESS"));
        IVerifier withdrawVerifier = IVerifier(vm.envAddress("WITHDRAW_VERIFIER_ADDRESS"));
        IVerifier membershipVerifier = IVerifier(vm.envAddress("MEMBERSHIP_VERIFIER_ADDRESS"));

        vm.startBroadcast();

        ASPRegistry aspRegistry = new ASPRegistry(deployer);
        console2.log("ASPRegistry:", address(aspRegistry));
        IASPRegistry asp = IASPRegistry(address(aspRegistry));

        // Deploy BNB pools
        uint256[3] memory bnbDenoms = [BNB_01, BNB_1, BNB_10];
        address[3] memory bnbPools;
        for (uint256 i = 0; i < 3; i++) {
            PrivacyPool pool = new PrivacyPool(hasher, withdrawVerifier, asp, bnbDenoms[i]);
            bnbPools[i] = address(pool);
            console2.log("BNB Pool", bnbDenoms[i] / 1e17, ":", address(pool));
        }

        // Deploy stablecoin pools
        address usdtAddr = vm.envOr("USDT_ADDRESS", address(0));
        if (usdtAddr != address(0)) {
            _deployTokenPools(hasher, withdrawVerifier, asp, usdtAddr);
        }

        address usdcAddr = vm.envOr("USDC_ADDRESS", address(0));
        if (usdcAddr != address(0)) {
            _deployTokenPools(hasher, withdrawVerifier, asp, usdcAddr);
        }

        // Deploy Paymaster
        uint256 maxGas = vm.envOr("MAX_GAS_SPONSORSHIP", uint256(0.01 ether));
        PrivacyPaymaster paymaster = new PrivacyPaymaster(
            IEntryPoint(ENTRYPOINT),
            deployer,
            membershipVerifier,
            asp,
            MerkleTreeWithHistory(bnbPools[1]),
            maxGas
        );
        console2.log("PrivacyPaymaster:", address(paymaster));

        vm.stopBroadcast();
    }
}
