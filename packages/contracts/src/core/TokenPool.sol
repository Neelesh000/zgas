// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {MerkleTreeWithHistory} from "./MerkleTreeWithHistory.sol";
import {IHasher} from "../interfaces/IHasher.sol";
import {IVerifier} from "../interfaces/IVerifier.sol";
import {IASPRegistry} from "../interfaces/IASPRegistry.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title TokenPool
/// @notice ERC-20 variant of PrivacyPool. Accepts fixed token denominations,
/// inserts commitments into a Merkle tree, and allows withdrawals via Groth16 ZK proofs.
/// Rejects fee-on-transfer tokens by validating exact balance changes.
contract TokenPool is MerkleTreeWithHistory, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable token;
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
    error FeeOnTransferNotSupported();

    constructor(
        IHasher _hasher,
        IVerifier _withdrawVerifier,
        IASPRegistry _aspRegistry,
        IERC20 _token,
        uint256 _denomination
    ) MerkleTreeWithHistory(_hasher) {
        require(_denomination > 0, "denomination must be > 0");
        require(address(_token) != address(0), "invalid token");
        withdrawVerifier = _withdrawVerifier;
        aspRegistry = _aspRegistry;
        token = _token;
        denomination = _denomination;
    }

    /// @notice Deposit ERC-20 tokens into the pool with a commitment.
    /// @param commitment The Poseidon(secret, nullifier) commitment.
    function deposit(bytes32 commitment) external nonReentrant {
        if (commitments[commitment]) revert CommitmentAlreadyExists();

        commitments[commitment] = true;

        // Check for fee-on-transfer tokens
        uint256 balanceBefore = token.balanceOf(address(this));
        token.safeTransferFrom(msg.sender, address(this), denomination);
        uint256 balanceAfter = token.balanceOf(address(this));
        if (balanceAfter - balanceBefore != denomination) revert FeeOnTransferNotSupported();

        uint32 leafIndex = _insert(commitment);

        emit Deposit(commitment, leafIndex, block.timestamp, denomination);
    }

    /// @notice Withdraw tokens by providing a valid ZK proof.
    function withdraw(
        bytes calldata _proof,
        bytes32 _root,
        bytes32 _nullifierHash,
        address _recipient,
        address _relayer,
        uint256 _fee,
        uint256 _refund,
        bytes32 _aspRoot
    ) external nonReentrant {
        if (nullifierHashes[_nullifierHash]) revert NullifierAlreadySpent();
        if (!isKnownRoot(_root)) revert InvalidMerkleRoot();
        require(aspRegistry.isKnownASPRoot(_aspRoot), "Invalid ASP root");
        if (_fee > denomination) revert InvalidFee();
        require(_refund == 0, "refund not supported for token pools");

        (
            uint256[2] memory pA,
            uint256[2][2] memory pB,
            uint256[2] memory pC
        ) = abi.decode(_proof, (uint256[2], uint256[2][2], uint256[2]));

        uint256[] memory pubSignals = new uint256[](7);
        pubSignals[0] = uint256(_root);
        pubSignals[1] = uint256(_nullifierHash);
        pubSignals[2] = uint256(uint160(_recipient));
        pubSignals[3] = uint256(uint160(_relayer));
        pubSignals[4] = _fee;
        pubSignals[5] = _refund;
        pubSignals[6] = uint256(_aspRoot);

        if (!withdrawVerifier.verifyProof(pA, pB, pC, pubSignals)) {
            revert InvalidWithdrawProof();
        }

        nullifierHashes[_nullifierHash] = true;

        uint256 recipientAmount = denomination - _fee;
        token.safeTransfer(_recipient, recipientAmount);

        if (_fee > 0) {
            token.safeTransfer(_relayer, _fee);
        }

        emit Withdrawal(_recipient, _nullifierHash, _relayer, _fee);
    }
}
