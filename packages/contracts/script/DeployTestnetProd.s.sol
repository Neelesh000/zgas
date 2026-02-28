// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {PrivacyPool} from "../src/core/PrivacyPool.sol";
import {ASPRegistry} from "../src/compliance/ASPRegistry.sol";
import {PoseidonHasher} from "../src/core/PoseidonHasher.sol";
import {WithdrawGroth16Verifier} from "../src/verifiers/WithdrawGroth16Verifier.sol";
import {WithdrawVerifier} from "../src/verifiers/WithdrawVerifier.sol";
import {MembershipGroth16Verifier} from "../src/verifiers/MembershipGroth16Verifier.sol";
import {MembershipVerifier} from "../src/verifiers/MembershipVerifier.sol";
import {IHasher} from "../src/interfaces/IHasher.sol";
import {IVerifier} from "../src/interfaces/IVerifier.sol";
import {IASPRegistry} from "../src/interfaces/IASPRegistry.sol";
import {PrivacyPaymaster} from "../src/paymaster/PrivacyPaymaster.sol";
import {MerkleTreeWithHistory} from "../src/core/MerkleTreeWithHistory.sol";
import {EntryPoint} from "account-abstraction/core/EntryPoint.sol";
import {SimpleAccountFactory} from "account-abstraction/accounts/SimpleAccountFactory.sol";
import {IEntryPoint} from "account-abstraction/interfaces/IEntryPoint.sol";

/// @notice BSC testnet deployment with real Poseidon hasher + Groth16 verifiers.
contract DeployTestnetProd is Script {
    function run() external {
        vm.startBroadcast();

        address deployer = msg.sender;
        console2.log("Deployer:", deployer);

        // Deploy core infrastructure
        (IHasher hasher, IVerifier wv, IVerifier mv) = _deployCoreInfra();

        // Deploy ASP Registry
        ASPRegistry aspRegistry = new ASPRegistry(deployer);
        aspRegistry.updateASPRoot(bytes32(uint256(1)));
        console2.log("ASPRegistry:", address(aspRegistry));

        // Deploy pools + ERC-4337 stack
        _deployPoolsAndPaymaster(deployer, hasher, wv, mv, IASPRegistry(address(aspRegistry)));

        vm.stopBroadcast();
    }

    function _deployCoreInfra() internal returns (IHasher, IVerifier, IVerifier) {
        // Real Poseidon hasher from bytecode
        bytes memory poseidonBytecode = vm.parseBytes(vm.readFile("src/core/PoseidonT3Bytecode.txt"));
        address poseidonT3;
        assembly {
            poseidonT3 := create(0, add(poseidonBytecode, 0x20), mload(poseidonBytecode))
        }
        require(poseidonT3 != address(0), "PoseidonT3 deployment failed");
        console2.log("PoseidonT3:", poseidonT3);

        PoseidonHasher hasher = new PoseidonHasher(poseidonT3);
        console2.log("PoseidonHasher:", address(hasher));

        // Real Groth16 verifiers
        WithdrawGroth16Verifier wg16 = new WithdrawGroth16Verifier();
        WithdrawVerifier wv = new WithdrawVerifier(wg16);
        console2.log("WithdrawGroth16Verifier:", address(wg16));
        console2.log("WithdrawVerifier:", address(wv));

        MembershipGroth16Verifier mg16 = new MembershipGroth16Verifier();
        MembershipVerifier mv = new MembershipVerifier(mg16);
        console2.log("MembershipGroth16Verifier:", address(mg16));
        console2.log("MembershipVerifier:", address(mv));

        return (IHasher(address(hasher)), IVerifier(address(wv)), IVerifier(address(mv)));
    }

    function _deployPoolsAndPaymaster(
        address deployer,
        IHasher hasher,
        IVerifier withdrawVerifier,
        IVerifier membershipVerifier,
        IASPRegistry aspRegistry
    ) internal {
        // BNB Privacy Pools
        PrivacyPool pool01 = new PrivacyPool(hasher, withdrawVerifier, aspRegistry, 0.1 ether);
        console2.log("0.1 BNB Pool:", address(pool01));

        PrivacyPool pool1 = new PrivacyPool(hasher, withdrawVerifier, aspRegistry, 1 ether);
        console2.log("1 BNB Pool:", address(pool1));

        PrivacyPool pool10 = new PrivacyPool(hasher, withdrawVerifier, aspRegistry, 10 ether);
        console2.log("10 BNB Pool:", address(pool10));

        // ERC-4337 stack
        EntryPoint entryPoint = new EntryPoint();
        console2.log("EntryPoint:", address(entryPoint));

        SimpleAccountFactory factory = new SimpleAccountFactory(IEntryPoint(address(entryPoint)));
        console2.log("SimpleAccountFactory:", address(factory));

        PrivacyPaymaster paymaster = new PrivacyPaymaster(
            IEntryPoint(address(entryPoint)),
            deployer,
            membershipVerifier,
            aspRegistry,
            MerkleTreeWithHistory(address(pool1)),
            0.01 ether
        );
        console2.log("PrivacyPaymaster:", address(paymaster));

        // Fund paymaster at EntryPoint
        entryPoint.depositTo{value: 0.05 ether}(address(paymaster));
        console2.log("Paymaster funded with 0.05 BNB at EntryPoint");
    }
}
