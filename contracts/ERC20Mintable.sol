// SPDX-License-Identifier: MIT

pragma solidity ^0.7.0;


import "@openzeppelin/contracts/token/ERC20/ERC20Burnable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract ERC20Mintable is ERC20Burnable, Ownable {
    using SafeMath for uint256;

    constructor(string memory name_, string memory symbol_) public ERC20(name_, symbol_) {}

    function mint(address account, uint256 amount) external onlyOwner {
        _mint(account, amount);
    }

    /**
     * @dev Destroys `amount` tokens from the caller.
     *
     * See {ERC20-_burn}.
     */
    function burn(uint256 amount) public virtual override {
        _burn(_msgSender(), amount);
    }

    /**
     * @dev Destroys `amount` tokens from `account`, deducting from the caller's
     * allowance.
     *
     * See {ERC20-_burn} and {ERC20-allowance}.
     *
     * Requirements:
     *
     * - the caller must have allowance for ``accounts``'s tokens of at least
     * `amount`.
     */
    function burnFrom(address account, uint256 amount) public virtual override {
        uint256 decreasedAllowance = allowance(account, _msgSender()).sub(
            amount,
            "ERC20: burn amount exceeds allowance"
        );

        _approve(account, _msgSender(), decreasedAllowance);
        _burn(account, amount);
    }
}

// /**
//  * @dev {ERC20} token, including:
//  *
//  *  - ability for holders to burn (destroy) their tokens
//  *  - a minter role that allows for token minting (creation)
//  *  - a pauser role that allows to stop all token transfers
//  *
//  * This contract uses {AccessControl} to lock permissioned functions using the
//  * different roles - head to its documentation for details.
//  *
//  * The account that deploys the contract will be granted the minter and pauser
//  * roles, as well as the default admin role, which will let it grant both minter
//  * and pauser roles to other accounts.
//  */
// contract ERC20PresetMinterPauser is Context, AccessControlEnumerable, ERC20Burnable, ERC20Pausable {
//     bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
//     bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

//     /**
//      * @dev Grants `DEFAULT_ADMIN_ROLE`, `MINTER_ROLE` and `PAUSER_ROLE` to the
//      * account that deploys the contract.
//      *
//      * See {ERC20-constructor}.
//      */
//     constructor(string memory name, string memory symbol) ERC20(name, symbol) {
//         _setupRole(DEFAULT_ADMIN_ROLE, _msgSender());

//         _setupRole(MINTER_ROLE, _msgSender());
//         _setupRole(PAUSER_ROLE, _msgSender());
//     }

//     /**
//      * @dev Creates `amount` new tokens for `to`.
//      *
//      * See {ERC20-_mint}.
//      *
//      * Requirements:
//      *
//      * - the caller must have the `MINTER_ROLE`.
//      */
//     function mint(address to, uint256 amount) public virtual {
//         require(hasRole(MINTER_ROLE, _msgSender()), "ERC20PresetMinterPauser: must have minter role to mint");
//         _mint(to, amount);
//     }

//     /**
//      * @dev Pauses all token transfers.
//      *
//      * See {ERC20Pausable} and {Pausable-_pause}.
//      *
//      * Requirements:
//      *
//      * - the caller must have the `PAUSER_ROLE`.
//      */
//     function pause() public virtual {
//         require(hasRole(PAUSER_ROLE, _msgSender()), "ERC20PresetMinterPauser: must have pauser role to pause");
//         _pause();
//     }

//     /**
//      * @dev Unpauses all token transfers.
//      *
//      * See {ERC20Pausable} and {Pausable-_unpause}.
//      *
//      * Requirements:
//      *
//      * - the caller must have the `PAUSER_ROLE`.
//      */
//     function unpause() public virtual {
//         require(hasRole(PAUSER_ROLE, _msgSender()), "ERC20PresetMinterPauser: must have pauser role to unpause");
//         _unpause();
//     }

//     function _beforeTokenTransfer(
//         address from,
//         address to,
//         uint256 amount
//     ) internal virtual override(ERC20, ERC20Pausable) {
//         super._beforeTokenTransfer(from, to, amount);
//     }
// }
