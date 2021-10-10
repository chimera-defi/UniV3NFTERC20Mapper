// SPDX-License-Identifier: GPL-2.0-or-later

/**
UniV3NFTERC20Mapper

Given an Uni v3 pool nft -> generate ERC20 for locking the pos nft

A UNIv3ToERC20 tokenID to address mapping keeps track of all tokenIDs associated with ERC20s
The related ERC20 address is generated from the name of the token pool and checked for existence

Whereas G-uni pools use the `uniswapV3MintCallback` requiring the pool to be created via their contracts
This contract will let user created uni v3 pools be mapped to ERC20
Guni: https://etherscan.io/address/0xf517263181e468fa958050cd6abfb58a445772ce#code

Flow:

- On deposit, the NFT position needs to be transfered to this contract
- This will trigger a onERC721Received fn
- We accept the deposit and keep an account using _staketoken
- Create a user info object, with the stake info
- We generate a custom name for the ERC20 token to mint, using the pool0 and pool1 info from the nft
- Use secondsPerLiquidityInsideInitialX128 to create an initial snapshot of erc20 tokens to mint
- If the erc20 token already exists, we mint secondsPerLiquidityInsideInitialX128 amount to the user
- Otherwise we create it 


- On unstake, we transfer `amountMinted` from user to the contract for the ERC20 associated with the NFT tokenID
- We burn the ERC20
- We update accounting
- Transfer the nft back to the user

- Since secondsPerLiquidityInsideInitialX128 increases over time, a user who creates a LP a long time before trigerring this contract will get more ERC20 tokens
- A user can come back and call mintForUser to update accounting and get any new;y deserved tokens
 */
pragma solidity =0.7.6;
pragma abicoder v2;

import "@uniswap/v3-staker/contracts/libraries/NFTPositionInfo.sol";
import "@uniswap/v3-staker/contracts/interfaces/IUniswapV3Staker.sol";

import "@uniswap/v3-core/contracts/interfaces/IUniswapV3Factory.sol";
import "@uniswap/v3-staker/contracts/interfaces/IUniswapV3Staker.sol";

import "@uniswap/v3-periphery/contracts/interfaces/INonfungiblePositionManager.sol";
import "@uniswap/v3-periphery/contracts/libraries/TransferHelper.sol";

import "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
// import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

import "./ERC20Mintable.sol";

contract UniV3NFTERC20Mapper is IERC721Receiver {
    /// @notice Emitted when ownership of a deposit changes
    /// @param tokenId The ID of the deposit (and token) that is being transferred
    /// @param oldOwner The owner before the deposit was transferred
    /// @param newOwner The owner after the deposit was transferred
    event DepositTransferred(uint256 indexed tokenId, address indexed oldOwner, address indexed newOwner);

    struct UserInfo {
        uint256 amount;
        uint256 tokensMinted;
        uint256 tokenID;
        bool isStaked;
    }
    /// @notice Represents the deposit of a liquidity NFT
    struct Deposit {
        address owner;
        uint48 numberOfStakes;
        int24 tickLower;
        int24 tickUpper;
    }

    /// @dev deposits[tokenId] => Deposit
    mapping(uint256 => Deposit) public deposits;

    /// @notice Represents a staked liquidity NFT
    struct Stake {
        uint160 secondsPerLiquidityInsideInitialX128;
        uint96 liquidityNoOverflow;
        uint128 liquidityIfOverflow;
    }

    // token id => address of user => user info
    mapping(uint256 => mapping(address => UserInfo)) public userInfo;
    /// @dev stakes[tokenId][incentiveHash] => Stake
    mapping(uint256 => Stake) private _stakes;

    mapping(uint256 => address) public UNIv3ToERC20;
    mapping(string => address) public nameToERC20;

    IUniswapV3Factory public immutable factory;
    INonfungiblePositionManager public immutable nonfungiblePositionManager;

    /// @param _factory the Uniswap V3 factory
    /// @param _nonfungiblePositionManager the NFT position manager contract address
    constructor(IUniswapV3Factory _factory, INonfungiblePositionManager _nonfungiblePositionManager) {
        factory = _factory;
        nonfungiblePositionManager = _nonfungiblePositionManager;
    }

    function mintForUser(uint256 tokenID) public {
        _updateUserInfo(tokenID);
        address owner = deposits[tokenID].owner;
        UserInfo memory uinfo = userInfo[tokenID][owner];

        require(uinfo.isStaked, "Token is not staked");
        uint256 amountToMint = uinfo.amount - uinfo.tokensMinted;

        (IUniswapV3Pool pool, int24 tickLower, int24 tickUpper, uint128 liquidity) = NFTPositionInfo.getPositionInfo(
            factory,
            nonfungiblePositionManager,
            tokenID
        );

        require(liquidity > 0, "UniswapV3Staker::stakeToken: cannot stake token with 0 liquidity");

        uinfo.tokensMinted += amountToMint;
        userInfo[tokenID][owner] = uinfo;

        _getERC20(tokenID, pool).mint(owner, amountToMint);
    }

    function burnForUser(uint256 tokenID) internal {
        _updateUserInfo(tokenID);
        address owner = deposits[tokenID].owner;

        UserInfo memory uinfo = userInfo[tokenID][owner];

        (IUniswapV3Pool pool, int24 tickLower, int24 tickUpper, uint128 liquidity) = NFTPositionInfo.getPositionInfo(
            factory,
            nonfungiblePositionManager,
            tokenID
        );

        ERC20Mintable token = _getERC20(tokenID, pool);

        // .mint(msg.sender, amountToMint);

        uint256 tokensMinted = uinfo.tokensMinted;

        TransferHelper.safeTransferFrom(address(token), owner, address(this), tokensMinted);
        token.burn(tokensMinted);
        uinfo.tokensMinted = 0;
        userInfo[tokenID][owner] = uinfo;
    }

    // function unstakeToken(IncentiveKey memory key, uint256 tokenId) external;
    function unstakeToken(uint256 tokenId) internal {
        Deposit memory deposit = deposits[tokenId];
        deposits[tokenId].numberOfStakes--;
    }

    function withdrawToken(
        uint256 tokenId,
        address to,
        bytes memory data
    ) public {
        require(to != address(this), "UniswapV3Staker::withdrawToken: cannot withdraw to staker");
        Deposit memory deposit = deposits[tokenId];
        require(deposit.numberOfStakes == 0, "UniswapV3Staker::withdrawToken: cannot withdraw token while staked");
        require(deposit.owner == msg.sender, "UniswapV3Staker::withdrawToken: only owner can withdraw token");

        delete deposits[tokenId];
        emit DepositTransferred(tokenId, deposit.owner, address(0));

        nonfungiblePositionManager.safeTransferFrom(address(this), to, tokenId, data);
    }

    function withdraw(uint256 tokenId) external {
        burnForUser(tokenId);
        unstakeToken(tokenId);
        withdrawToken(tokenId, msg.sender, "0x");
    }

    function _getERC20(uint256 tokenID, IUniswapV3Pool pool) internal returns (ERC20Mintable) {
        if (UNIv3ToERC20[tokenID] == address(0)) {
            string memory name = _getTokenName(pool);
            if (nameToERC20[name] == address(0)) {
                nameToERC20[name] = address(new ERC20Mintable(name, name));
            }
            UNIv3ToERC20[tokenID] = nameToERC20[name];
        }
        return ERC20Mintable(UNIv3ToERC20[tokenID]);
    }

    /// @notice Upon receiving a Uniswap V3 ERC721, creates the token deposit setting owner to `from`. Also stakes token
    /// in one or more incentives if properly formatted `data` has a length > 0.
    /// @inheritdoc IERC721Receiver
    function onERC721Received(
        address,
        address from,
        uint256 tokenId,
        bytes calldata data
    ) external override returns (bytes4) {
        require(
            msg.sender == address(nonfungiblePositionManager),
            "UniswapV3Staker::onERC721Received: not a univ3 nft"
        );

        (, , , , , int24 tickLower, int24 tickUpper, , , , , ) = nonfungiblePositionManager.positions(tokenId);

        deposits[tokenId] = Deposit({owner: from, numberOfStakes: 0, tickLower: tickLower, tickUpper: tickUpper});
        emit DepositTransferred(tokenId, address(0), from);

        _stakeToken(tokenId);
        mintForUser(tokenId);
        // if (data.length > 0) {
        //     if (data.length == 160) {
        //         _stakeToken(abi.decode(data, (IncentiveKey)), tokenId);
        //     } else {
        //         IncentiveKey[] memory keys = abi.decode(data, (IncentiveKey[]));
        //         for (uint256 i = 0; i < keys.length; i++) {
        //             _stakeToken(keys[i], tokenId);
        //         }
        //     }
        // }
        return this.onERC721Received.selector;
    }

    function _updateUserInfo(uint256 tokenId) private {
        (IUniswapV3Pool pool, int24 tickLower, int24 tickUpper, uint128 liquidity) = NFTPositionInfo.getPositionInfo(
            factory,
            nonfungiblePositionManager,
            tokenId
        );
        require(liquidity > 0, "UniswapV3Staker::stakeToken: cannot stake token with 0 liquidity");
        (, uint160 secondsPerLiquidityInsideX128, ) = pool.snapshotCumulativesInside(tickLower, tickUpper);

        if (liquidity >= type(uint96).max) {
            _stakes[tokenId] = Stake({
                secondsPerLiquidityInsideInitialX128: secondsPerLiquidityInsideX128,
                liquidityNoOverflow: type(uint96).max,
                liquidityIfOverflow: liquidity
            });
        } else {
            Stake storage stake = _stakes[tokenId];
            stake.secondsPerLiquidityInsideInitialX128 = secondsPerLiquidityInsideX128;
            stake.liquidityNoOverflow = uint96(liquidity);
        }

        address owner = deposits[tokenId].owner;

        uint256 tokensMinted = userInfo[tokenId][owner].tokensMinted;

        userInfo[tokenId][owner] = UserInfo({
            amount: _stakes[tokenId].secondsPerLiquidityInsideInitialX128,
            tokensMinted: tokensMinted,
            tokenID: tokenId,
            isStaked: true
        });
    }

    /// @dev Stakes a deposited token without doing an ownership check
    function _stakeToken(uint256 tokenId) private {
        (IUniswapV3Pool pool, int24 tickLower, int24 tickUpper, uint128 liquidity) = NFTPositionInfo.getPositionInfo(
            factory,
            nonfungiblePositionManager,
            tokenId
        );
        require(liquidity > 0, "UniswapV3Staker::stakeToken: cannot stake token with 0 liquidity");

        deposits[tokenId].numberOfStakes++;

        // (, uint160 secondsPerLiquidityInsideX128, ) = pool.snapshotCumulativesInside(tickLower, tickUpper);
        // _updateUserInfo(tokenId);
        // if (liquidity >= type(uint96).max) {
        //     _stakes[tokenId] = Stake({
        //         secondsPerLiquidityInsideInitialX128: secondsPerLiquidityInsideX128,
        //         liquidityNoOverflow: type(uint96).max,
        //         liquidityIfOverflow: liquidity
        //     });
        // } else {
        //     Stake storage stake = _stakes[tokenId];
        //     stake.secondsPerLiquidityInsideInitialX128 = secondsPerLiquidityInsideX128;
        //     stake.liquidityNoOverflow = uint96(liquidity);
        // }

        // uint256 tokensMinted = userInfo[tokenId][msg.sender].tokensMinted;

        // userInfo[tokenId][msg.sender] = UserInfo({amount: _stakes[tokenId].secondsPerLiquidityInsideX128, tokensMinted: tokensMinted, tokenID: tokenId, isStaked: true});

        // emit TokenStaked(tokenId, liquidity);
    }

    function _getTokenName(IUniswapV3Pool pool) internal returns (string memory) {
        return getTokenName(pool.token0(), pool.token1());
    }

    function getTokenName(address token0, address token1) public view returns (string memory) {
        string memory symbol0 = ERC20(token0).symbol();
        string memory symbol1 = ERC20(token1).symbol();

        return _append("Uniswap v3", symbol0, "/", symbol1, " LP");
    }

    function _append(
        string memory a,
        string memory b,
        string memory c,
        string memory d,
        string memory e
    ) internal pure returns (string memory) {
        return string(abi.encodePacked(a, b, c, d, e));
    }
}
