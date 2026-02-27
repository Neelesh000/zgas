// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title Denomination
/// @notice Validates amounts against allowed denominations per token.
library Denomination {
    // BNB denominations (in wei)
    uint256 public constant BNB_01 = 0.1 ether;
    uint256 public constant BNB_1 = 1 ether;
    uint256 public constant BNB_10 = 10 ether;

    // Stablecoin denominations (18 decimals on BSC)
    uint256 public constant STABLE_100 = 100 * 1e18;
    uint256 public constant STABLE_1000 = 1_000 * 1e18;
    uint256 public constant STABLE_10000 = 10_000 * 1e18;

    function isValidBNBDenomination(uint256 amount) internal pure returns (bool) {
        return amount == BNB_01 || amount == BNB_1 || amount == BNB_10;
    }

    function isValidStableDenomination(uint256 amount) internal pure returns (bool) {
        return amount == STABLE_100 || amount == STABLE_1000 || amount == STABLE_10000;
    }
}
