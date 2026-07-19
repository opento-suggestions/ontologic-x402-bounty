// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.20;

/**
 * WitnessVendingMachine — KEY custody for Witness Required (testnet MVP).
 *
 * Role, per verify-log V-1b (facilitator-first branch): the x402 payment
 * settles as a plain native TransferTransaction OUTSIDE this contract (the
 * settled transfer is the payment receipt). This contract holds the ONE piece
 * of custody the design needs — the witness-KEY token's treasury and supply
 * key — and executes the DELIVERY leg:
 *
 *   vend()  — mint 1 KEY, deliver to the newborn testimony address, and
 *             forward alias-funding HBAR (lazy account creation) in one
 *             atomic call. Any leg fails → whole delivery reverts → the
 *             payer's redeemable right survives, re-executable. (W-1 Lane B)
 *   burnCollected() — burn KEY that flowed back to the treasury as HIP-991
 *             Lane B stamp fees. Sink, not reserve (D-3): consumed KEY exits
 *             supply; no treasury position accumulates.
 *
 * The contract itself is the token treasury AND the Lane B fee collector, so
 * self-executing neutrality is structural: collected KEY sits in code, and
 * only exits by burning. The operator account holds the admin relationship
 * only (blast radius disclosed in LIMITATIONS.md — it can slander, not forge:
 * no function here signs payer testimony, W-2).
 *
 * Deliberately testnet-light: no pause, no drain, noted for the mainnet story.
 */

/// @custom:address 0x167 (HTS system contract on Hedera)
interface IHederaTokenService {
    struct Expiry {
        int64 second;
        address autoRenewAccount;
        int64 autoRenewPeriod;
    }

    struct KeyValue {
        bool inheritAccountKey;
        address contractId;
        bytes ed25519;
        bytes ECDSA_secp256k1;
        address delegatableContractId;
    }

    struct TokenKey {
        uint256 keyType;
        KeyValue key;
    }

    struct HederaToken {
        string name;
        string symbol;
        address treasury;
        string memo;
        bool tokenSupplyType;
        int64 maxSupply;
        bool freezeDefault;
        TokenKey[] tokenKeys;
        Expiry expiry;
    }

    function createFungibleToken(
        HederaToken memory token,
        int64 initialTotalSupply,
        int32 decimals
    ) external payable returns (int64 responseCode, address tokenAddress);

    function mintToken(
        address token,
        int64 amount,
        bytes[] memory metadata
    ) external returns (int64 responseCode, int64 newTotalSupply, int64[] memory serialNumbers);

    function burnToken(
        address token,
        int64 amount,
        int64[] memory serialNumbers
    ) external returns (int64 responseCode, int64 newTotalSupply);

    function transferToken(
        address token,
        address sender,
        address receiver,
        int64 amount
    ) external returns (int64 responseCode);
}

contract WitnessVendingMachine {
    IHederaTokenService public constant HTS = IHederaTokenService(address(0x167));
    int64 internal constant HTS_SUCCESS = 22;
    uint256 internal constant KEY_TYPE_SUPPLY = 16; // supplyKey bit (1 << 4)

    address public immutable operator;
    address public keyToken;

    event KeyTokenCreated(address token);
    event Vended(address indexed to, uint256 aliasFundingWei);
    event Burned(int64 amount, int64 newTotalSupply);

    error NotOperator();
    error AlreadyCreated();
    error NotCreated();
    error HtsFailed(string leg, int64 code);
    error FundingFailed();

    modifier onlyOperator() {
        if (msg.sender != operator) revert NotOperator();
        _;
    }

    constructor() {
        operator = msg.sender;
    }

    /**
     * Create the witness-KEY token via the HTS system contract: treasury =
     * this contract, supply key = this contract, no admin key (immutable
     * token — nobody, including ORG, can re-key it). Payable: token creation
     * carries an HTS fee; send ~25 HBAR, excess is kept by the network call.
     */
    function createKeyToken() external payable onlyOperator returns (address) {
        if (keyToken != address(0)) revert AlreadyCreated();

        IHederaTokenService.TokenKey[] memory keys = new IHederaTokenService.TokenKey[](1);
        keys[0] = IHederaTokenService.TokenKey({
            keyType: KEY_TYPE_SUPPLY,
            key: IHederaTokenService.KeyValue({
                inheritAccountKey: false,
                contractId: address(this),
                ed25519: "",
                ECDSA_secp256k1: "",
                delegatableContractId: address(0)
            })
        });

        IHederaTokenService.HederaToken memory token = IHederaTokenService.HederaToken({
            name: "Witness KEY",
            symbol: "wKEY",
            treasury: address(this),
            memo: '{"purpose":"1 KEY = 1 stamp, burned on execution (W-4/D-3)","steward":"ORG"}',
            tokenSupplyType: false, // infinite
            maxSupply: 0,
            freezeDefault: false,
            tokenKeys: keys,
            expiry: IHederaTokenService.Expiry({
                second: 0,
                autoRenewAccount: address(this),
                autoRenewPeriod: 7776000
            })
        });

        (int64 code, address tokenAddress) = HTS.createFungibleToken{value: msg.value}(token, 0, 0);
        if (code != HTS_SUCCESS) revert HtsFailed("create", code);
        keyToken = tokenAddress;
        emit KeyTokenCreated(tokenAddress);
        return tokenAddress;
    }

    /**
     * The delivery leg. `to` is the newborn testimony address (EVM alias —
     * the HBAR value transfer lazy-creates the account). One atomic call:
     * fund the alias into existence, mint 1 KEY, hand it over. Any failure
     * reverts every leg.
     */
    function vend(address payable to) external payable onlyOperator {
        if (keyToken == address(0)) revert NotCreated();

        // 1. Fund the alias (lazy account creation) with the payer's gas money.
        if (msg.value > 0) {
            (bool ok, ) = to.call{value: msg.value}("");
            if (!ok) revert FundingFailed();
        }

        // 2. Mint exactly 1 KEY to treasury (this contract).
        (int64 mintCode, , ) = HTS.mintToken(keyToken, 1, new bytes[](0));
        if (mintCode != HTS_SUCCESS) revert HtsFailed("mint", mintCode);

        // 3. Deliver it (newborn receives via auto-association).
        int64 xferCode = HTS.transferToken(keyToken, address(this), to, 1);
        if (xferCode != HTS_SUCCESS) revert HtsFailed("transfer", xferCode);

        emit Vended(to, msg.value);
    }

    /**
     * D-3: burn KEY that returned to treasury as Lane B stamp fees (the
     * contract is the fee collector). Sink, not reserve.
     */
    function burnCollected(int64 amount) external onlyOperator {
        if (keyToken == address(0)) revert NotCreated();
        (int64 code, int64 newSupply) = HTS.burnToken(keyToken, amount, new int64[](0));
        if (code != HTS_SUCCESS) revert HtsFailed("burn", code);
        emit Burned(amount, newSupply);
    }

    /// The contract must be able to receive the HBAR that funds vend calls.
    receive() external payable {}
}
