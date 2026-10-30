// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title ZyonPaymentSplitter
 * @notice Atomic payment splitter for Zyon checkout.
 *         Buyer approves token → calls pay() → merchant receives (amount - fee),
 *         Zyon treasury receives the platform fee. No custodial risk.
 *
 * @dev Deploy once per chain (Polygon, Base). Immutable treasury.
 *      Platform fee adjustable by owner (capped at 10%).
 *
 * Gas cost per payment: ~65k gas (~$0.003 on Polygon PoS)
 */
contract ZyonPaymentSplitter is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @notice Platform fee in basis points (100 = 1%, 300 = 3%)
    uint256 public platformFeeBps;

    /// @notice Maximum fee cap: 10% (1000 bps)
    uint256 public constant MAX_FEE_BPS = 1000;

    /// @notice Zyon treasury that receives platform fees
    address public immutable treasury;

    /// @notice Accepted payment tokens (USDC, USDT)
    mapping(address => bool) public acceptedTokens;

    event PaymentProcessed(
        address indexed buyer,
        address indexed merchant,
        address indexed token,
        uint256 merchantAmount,
        uint256 feeAmount,
        bytes32 orderId
    );

    event FeeUpdated(uint256 oldFeeBps, uint256 newFeeBps);
    event TokenAccepted(address indexed token, bool accepted);

    error InvalidMerchant();
    error InvalidAmount();
    error TokenNotAccepted();
    error FeeTooHigh();

    constructor(
        address _treasury,
        uint256 _initialFeeBps,
        address[] memory _tokens
    ) Ownable(msg.sender) {
        if (_treasury == address(0)) revert InvalidMerchant();
        if (_initialFeeBps > MAX_FEE_BPS) revert FeeTooHigh();

        treasury = _treasury;
        platformFeeBps = _initialFeeBps;

        for (uint256 i = 0; i < _tokens.length; i++) {
            acceptedTokens[_tokens[i]] = true;
            emit TokenAccepted(_tokens[i], true);
        }
    }

    /**
     * @notice Process a checkout payment with atomic fee split.
     * @param token ERC-20 token address (must be accepted)
     * @param merchant Wallet that receives the payment
     * @param amount Total payment amount in token decimals
     * @param orderId Off-chain order reference for event indexing
     *
     * @dev Buyer must have approved this contract for `amount` before calling.
     *      Uses transferFrom for both splits — atomic, no intermediate custody.
     */
    function pay(
        address token,
        address merchant,
        uint256 amount,
        bytes32 orderId
    ) external nonReentrant {
        if (merchant == address(0)) revert InvalidMerchant();
        if (amount == 0) revert InvalidAmount();
        if (!acceptedTokens[token]) revert TokenNotAccepted();

        uint256 fee = (amount * platformFeeBps) / 10000;
        uint256 merchantAmount = amount - fee;

        IERC20 payToken = IERC20(token);

        // Atomic split: both transfers in same tx
        if (fee > 0) {
            payToken.safeTransferFrom(msg.sender, treasury, fee);
        }
        payToken.safeTransferFrom(msg.sender, merchant, merchantAmount);

        emit PaymentProcessed(msg.sender, merchant, token, merchantAmount, fee, orderId);
    }

    // --- Admin functions ---

    /**
     * @notice Update platform fee (owner only, capped at MAX_FEE_BPS)
     */
    function setFee(uint256 newFeeBps) external onlyOwner {
        if (newFeeBps > MAX_FEE_BPS) revert FeeTooHigh();
        uint256 old = platformFeeBps;
        platformFeeBps = newFeeBps;
        emit FeeUpdated(old, newFeeBps);
    }

    /**
     * @notice Add or remove accepted payment tokens
     */
    function setAcceptedToken(address token, bool accepted) external onlyOwner {
        acceptedTokens[token] = accepted;
        emit TokenAccepted(token, accepted);
    }

    /**
     * @notice Read-only: calculate fee for a given amount
     */
    function calculateFee(uint256 amount) external view returns (uint256 fee, uint256 merchantAmount) {
        fee = (amount * platformFeeBps) / 10000;
        merchantAmount = amount - fee;
    }
}
