// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {PrivacyPool} from "../src/core/PrivacyPool.sol";
import {TokenPool} from "../src/core/TokenPool.sol";
import {ASPRegistry} from "../src/compliance/ASPRegistry.sol";
import {MockHasher} from "../src/mocks/MockHasher.sol";
import {MockVerifier} from "../src/mocks/MockVerifier.sol";
import {MockASPRegistry} from "../src/mocks/MockASPRegistry.sol";
import {IHasher} from "../src/interfaces/IHasher.sol";
import {IVerifier} from "../src/interfaces/IVerifier.sol";
import {IASPRegistry} from "../src/interfaces/IASPRegistry.sol";
import {PrivacyPaymaster} from "../src/paymaster/PrivacyPaymaster.sol";
import {MerkleTreeWithHistory} from "../src/core/MerkleTreeWithHistory.sol";
import {EntryPoint} from "account-abstraction/core/EntryPoint.sol";
import {SimpleAccountFactory} from "account-abstraction/accounts/SimpleAccountFactory.sol";
import {IEntryPoint} from "account-abstraction/interfaces/IEntryPoint.sol";

/// @notice Local devnet deployment — full ERC-4337 stack with mocks.
contract DeployLocal is Script {
    function run() external {
        uint256 deployerKey = vm.envOr("PRIVATE_KEY", uint256(0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80));
        vm.startBroadcast(deployerKey);

        address deployer = vm.addr(deployerKey);
        console2.log("Deployer:", deployer);

        // Deploy mocks
        MockHasher hasher = new MockHasher();
        console2.log("MockHasher:", address(hasher));

        MockVerifier withdrawVerifier = new MockVerifier();
        console2.log("MockWithdrawVerifier:", address(withdrawVerifier));

        // Deploy ASP Registry (real one, not mock)
        ASPRegistry aspRegistry = new ASPRegistry(deployer);
        console2.log("ASPRegistry:", address(aspRegistry));

        // Set an initial ASP root so withdrawals can work
        bytes32 initialASPRoot = bytes32(uint256(1));
        aspRegistry.updateASPRoot(initialASPRoot);
        console2.log("Initial ASP root set");

        // Deploy BNB pools (3 denominations)
        uint256[3] memory denoms = [uint256(0.1 ether), uint256(1 ether), uint256(10 ether)];
        string[3] memory labels = ["0.1 BNB", "1 BNB", "10 BNB"];

        address firstPool;
        for (uint256 i = 0; i < 3; i++) {
            PrivacyPool pool = new PrivacyPool(
                IHasher(address(hasher)),
                IVerifier(address(withdrawVerifier)),
                IASPRegistry(address(aspRegistry)),
                denoms[i]
            );
            console2.log(labels[i], "Pool:", address(pool));
            if (i == 0) firstPool = address(pool);
        }

        // ---- ERC-4337 stack ----

        // Deploy EntryPoint
        EntryPoint entryPoint = new EntryPoint();
        console2.log("EntryPoint:", address(entryPoint));

        // Deploy SimpleAccountFactory
        SimpleAccountFactory factory = new SimpleAccountFactory(IEntryPoint(address(entryPoint)));
        console2.log("SimpleAccountFactory:", address(factory));

        // Deploy membership verifier (separate mock for paymaster)
        MockVerifier membershipVerifier = new MockVerifier();
        console2.log("MockMembershipVerifier:", address(membershipVerifier));

        // Deploy PrivacyPaymaster
        PrivacyPaymaster paymaster = new PrivacyPaymaster(
            IEntryPoint(address(entryPoint)),
            deployer,
            IVerifier(address(membershipVerifier)),
            IASPRegistry(address(aspRegistry)),
            MerkleTreeWithHistory(firstPool),
            0.01 ether
        );
        console2.log("PrivacyPaymaster:", address(paymaster));

        // Fund the paymaster at EntryPoint with 10 ETH
        entryPoint.depositTo{value: 10 ether}(address(paymaster));
        console2.log("Paymaster funded with 10 ETH at EntryPoint");

        vm.stopBroadcast();
    }
}
