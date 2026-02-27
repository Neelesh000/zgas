// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {PrivacyPool} from "../src/core/PrivacyPool.sol";
import {ASPRegistry} from "../src/compliance/ASPRegistry.sol";
import {PrivacyPaymaster} from "../src/paymaster/PrivacyPaymaster.sol";
import {MockHasher} from "../src/mocks/MockHasher.sol";
import {MockVerifier} from "../src/mocks/MockVerifier.sol";
import {IHasher} from "../src/interfaces/IHasher.sol";
import {IVerifier} from "../src/interfaces/IVerifier.sol";
import {IASPRegistry} from "../src/interfaces/IASPRegistry.sol";
import {IEntryPoint} from "account-abstraction/interfaces/IEntryPoint.sol";
import {MerkleTreeWithHistory} from "../src/core/MerkleTreeWithHistory.sol";

/// @notice Deploys with mock contracts for testnet testing.
contract DeployTestnet is Script {
    address constant ENTRYPOINT = 0x0000000071727De22E5E9d8BAf0edAc6f37da032;

    function run() external {
        vm.startBroadcast();

        address deployer = msg.sender;

        // Deploy mocks
        MockHasher hasher = new MockHasher();
        MockVerifier withdrawVerifier = new MockVerifier();
        MockVerifier membershipVerifier = new MockVerifier();

        console2.log("MockHasher:", address(hasher));
        console2.log("MockWithdrawVerifier:", address(withdrawVerifier));
        console2.log("MockMembershipVerifier:", address(membershipVerifier));

        // Deploy ASP Registry
        ASPRegistry aspRegistry = new ASPRegistry(deployer);
        console2.log("ASPRegistry:", address(aspRegistry));

        // Deploy BNB pools
        uint256[3] memory denoms = [uint256(0.1 ether), uint256(1 ether), uint256(10 ether)];
        string[3] memory labels = ["0.1 BNB", "1 BNB", "10 BNB"];
        address[3] memory pools;

        for (uint256 i = 0; i < 3; i++) {
            PrivacyPool pool = new PrivacyPool(
                IHasher(address(hasher)),
                IVerifier(address(withdrawVerifier)),
                IASPRegistry(address(aspRegistry)),
                denoms[i]
            );
            pools[i] = address(pool);
            console2.log(labels[i], "Pool:", address(pool));
        }

        // Deploy Paymaster
        PrivacyPaymaster paymaster = new PrivacyPaymaster(
            IEntryPoint(ENTRYPOINT),
            deployer,
            IVerifier(address(membershipVerifier)),
            IASPRegistry(address(aspRegistry)),
            MerkleTreeWithHistory(pools[1]),
            0.01 ether
        );
        console2.log("PrivacyPaymaster:", address(paymaster));

        vm.stopBroadcast();
    }
}
