// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IASPRegistry {
    function isKnownASPRoot(bytes32 root) external view returns (bool);
    function getLastASPRoot() external view returns (bytes32);
}
