// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {BasePaymaster} from "account-abstraction/core/BasePaymaster.sol";
import {IEntryPoint} from "account-abstraction/interfaces/IEntryPoint.sol";
import {PackedUserOperation} from "account-abstraction/interfaces/PackedUserOperation.sol";
import {IVerifier} from "../interfaces/IVerifier.sol";
import {IASPRegistry} from "../interfaces/IASPRegistry.sol";
import {MerkleTreeWithHistory} from "../core/MerkleTreeWithHistory.sol";

/// @title PrivacyPaymaster
/// @notice ERC-4337 paymaster that sponsors gas for users who prove membership
/// in the privacy pool via a lightweight ZK proof. Uses domain-separated nullifiers
/// so a single deposit can support both withdrawal AND gas sponsorship.
contract PrivacyPaymaster is BasePaymaster {
    IVerifier public immutable membershipVerifier;
    IASPRegistry public immutable aspRegistry;
    MerkleTreeWithHistory public immutable pool;

    uint256 public maxGasSponsorship;

    mapping(bytes32 => bool) public sponsorshipNullifiers;

    event GasSponsored(
        bytes32 indexed nullifierHash,
        address indexed sender,
        uint256 gasCost
    );

    error NullifierAlreadyUsed();
    error InvalidMerkleRoot();
    error InvalidMembershipProof();
    error GasCostExceedsMax();
    error InvalidPaymasterDataLength();

    constructor(
        IEntryPoint _entryPoint,
        address _owner,
        IVerifier _membershipVerifier,
        IASPRegistry _aspRegistry,
        MerkleTreeWithHistory _pool,
        uint256 _maxGasSponsorship
    ) BasePaymaster(_entryPoint, _owner) {
        membershipVerifier = _membershipVerifier;
        aspRegistry = _aspRegistry;
        pool = _pool;
        maxGasSponsorship = _maxGasSponsorship;
    }

    /// @notice Set the maximum gas cost the paymaster will sponsor per UserOp.
    function setMaxGasSponsorship(uint256 _maxGasSponsorship) external onlyOwner {
        maxGasSponsorship = _maxGasSponsorship;
    }

    /// @notice Fund the paymaster's deposit at the EntryPoint.
    function fundPaymaster() external payable {
        deposit();
    }

    /// @notice Withdraw funds from the paymaster's EntryPoint deposit.
    function withdrawFunds(address payable to, uint256 amount) external onlyOwner {
        withdrawTo(to, amount);
    }

    /// @dev Validates the UserOp by verifying the ZK membership proof.
    /// paymasterAndData layout (after paymaster address + gas fields):
    ///   [0:256]   - proof (pA[2] + pB[2][2] + pC[2] = 8 uint256 = 256 bytes)
    ///   [256:288] - merkleRoot (bytes32)
    ///   [288:320] - nullifierHash (bytes32)
    ///   [320:352] - aspRoot (bytes32)
    function _validatePaymasterUserOp(
        PackedUserOperation calldata userOp,
        bytes32 /*userOpHash*/,
        uint256 maxCost
    ) internal override returns (bytes memory context, uint256 validationData) {
        if (maxCost > maxGasSponsorship) revert GasCostExceedsMax();

        // Extract paymaster data (after the standard 52-byte prefix)
        bytes calldata paymasterData = userOp.paymasterAndData[52:];
        if (paymasterData.length < 352) revert InvalidPaymasterDataLength();

        // Decode proof
        (
            uint256[2] memory pA,
            uint256[2][2] memory pB,
            uint256[2] memory pC
        ) = abi.decode(paymasterData[:256], (uint256[2], uint256[2][2], uint256[2]));

        bytes32 merkleRoot = bytes32(paymasterData[256:288]);
        bytes32 nullifierHash = bytes32(paymasterData[288:320]);
        bytes32 aspRoot = bytes32(paymasterData[320:352]);

        // Check nullifier hasn't been used
        if (sponsorshipNullifiers[nullifierHash]) revert NullifierAlreadyUsed();

        // Check merkle root is known in the pool
        if (!pool.isKnownRoot(merkleRoot)) revert InvalidMerkleRoot();

        // Check ASP root is valid
        require(aspRegistry.isKnownASPRoot(aspRoot), "Invalid ASP root");

        // Verify membership proof (3 public inputs: root, nullifierHash, aspRoot)
        uint256[] memory pubSignals = new uint256[](3);
        pubSignals[0] = uint256(merkleRoot);
        pubSignals[1] = uint256(nullifierHash);
        pubSignals[2] = uint256(aspRoot);

        if (!membershipVerifier.verifyProof(pA, pB, pC, pubSignals)) {
            revert InvalidMembershipProof();
        }

        // Mark nullifier as used
        sponsorshipNullifiers[nullifierHash] = true;

        // Return context for postOp
        context = abi.encode(nullifierHash, userOp.sender);
        validationData = 0; // Valid, no time range
    }

    /// @dev Post-operation handler: logs the gas sponsorship.
    function _postOp(
        PostOpMode /*mode*/,
        bytes calldata context,
        uint256 actualGasCost,
        uint256 /*actualUserOpFeePerGas*/
    ) internal override {
        (bytes32 nullifierHash, address sender) = abi.decode(context, (bytes32, address));
        emit GasSponsored(nullifierHash, sender, actualGasCost);
    }
}
