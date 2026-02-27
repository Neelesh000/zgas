// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {MerkleTreeWithHistory} from "./MerkleTreeWithHistory.sol";
import {IHasher} from "../interfaces/IHasher.sol";
import {IVerifier} from "../interfaces/IVerifier.sol";
import {IASPRegistry} from "../interfaces/IASPRegistry.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title PrivacyPool
/// @notice A privacy pool that accepts fixed BNB denominations, inserts commitments
/// into a Merkle tree, and allows withdrawals via Groth16 ZK proofs with ASP compliance.
/// One contract instance per (token, denomination) pair. This version handles native BNB.
contract PrivacyPool is MerkleTreeWithHistory, ReentrancyGuard {
    uint256 public immutable denomination;
    IVerifier public immutable withdrawVerifier;
    IASPRegistry public immutable aspRegistry;

    mapping(bytes32 => bool) public nullifierHashes;
    mapping(bytes32 => bool) public commitments;

    event Deposit(
        bytes32 indexed commitment,
        uint32 leafIndex,
        uint256 timestamp,
        uint256 denomination
    );

    event Withdrawal(
        address to,
        bytes32 nullifierHash,
        address indexed relayer,
        uint256 fee
    );

    error InvalidDenomination();
    error CommitmentAlreadyExists();
    error InvalidMerkleRoot();
    error NullifierAlreadySpent();
    error InvalidWithdrawProof();
    error InvalidFee();
    error PaymentFailed();

    constructor(
        IHasher _hasher,
        IVerifier _withdrawVerifier,
        IASPRegistry _aspRegistry,
        uint256 _denomination
    ) MerkleTreeWithHistory(_hasher) {
        require(_denomination > 0, "denomination must be > 0");
        withdrawVerifier = _withdrawVerifier;
        aspRegistry = _aspRegistry;
        denomination = _denomination;
    }

    /// @notice Deposit native BNB into the pool with a commitment.
    /// @param commitment The Poseidon(secret, nullifier) commitment.
    function deposit(bytes32 commitment) external payable nonReentrant {
        if (msg.value != denomination) revert InvalidDenomination();
        if (commitments[commitment]) revert CommitmentAlreadyExists();

        commitments[commitment] = true;
        uint32 leafIndex = _insert(commitment);

        emit Deposit(commitment, leafIndex, block.timestamp, denomination);
    }

    /// @notice Withdraw funds by providing a valid ZK proof.
    /// @param _proof Groth16 proof components [pA, pB, pC].
    /// @param _root Merkle root the proof was generated against.
    /// @param _nullifierHash Hash of the nullifier to prevent double-spending.
    /// @param _recipient Address to receive the withdrawn funds.
    /// @param _relayer Address of the relayer (can be address(0) for self-relay).
    /// @param _fee Fee paid to the relayer (deducted from denomination).
    /// @param _refund Refund amount for gas (for ERC-20 pools; 0 for BNB).
    /// @param _aspRoot The ASP Merkle root proving commitment is in the approved set.
    function withdraw(
        bytes calldata _proof,
        bytes32 _root,
        bytes32 _nullifierHash,
        address payable _recipient,
        address payable _relayer,
        uint256 _fee,
        uint256 _refund,
        bytes32 _aspRoot
    ) external nonReentrant {
        // Check nullifier hasn't been spent (save gas on replays)
        if (nullifierHashes[_nullifierHash]) revert NullifierAlreadySpent();
        // Check root is known
        if (!isKnownRoot(_root)) revert InvalidMerkleRoot();
        // Check ASP root is valid
        require(aspRegistry.isKnownASPRoot(_aspRoot), "Invalid ASP root");
        // Check fee is valid
        if (_fee > denomination) revert InvalidFee();

        // Decode proof
        (
            uint256[2] memory pA,
            uint256[2][2] memory pB,
            uint256[2] memory pC
        ) = abi.decode(_proof, (uint256[2], uint256[2][2], uint256[2]));

        // Construct public inputs: root, nullifierHash, recipient, relayer, fee, refund, aspRoot
        uint256[] memory pubSignals = new uint256[](7);
        pubSignals[0] = uint256(_root);
        pubSignals[1] = uint256(_nullifierHash);
        pubSignals[2] = uint256(uint160(address(_recipient)));
        pubSignals[3] = uint256(uint160(address(_relayer)));
        pubSignals[4] = _fee;
        pubSignals[5] = _refund;
        pubSignals[6] = uint256(_aspRoot);

        // Verify ZK proof
        if (!withdrawVerifier.verifyProof(pA, pB, pC, pubSignals)) {
            revert InvalidWithdrawProof();
        }

        // Mark nullifier as spent (effects before interactions)
        nullifierHashes[_nullifierHash] = true;

        // Transfer funds
        uint256 recipientAmount = denomination - _fee;
        (bool successRecipient, ) = _recipient.call{value: recipientAmount}("");
        if (!successRecipient) revert PaymentFailed();

        if (_fee > 0) {
            (bool successRelayer, ) = _relayer.call{value: _fee}("");
            if (!successRelayer) revert PaymentFailed();
        }

        emit Withdrawal(_recipient, _nullifierHash, _relayer, _fee);
    }
}
