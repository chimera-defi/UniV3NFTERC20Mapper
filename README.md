# Template base

Part of the SharedTools offering for consistent contracts and deployment patterns cross chain
https://medium.com/@chimera_defi/sharedtools-c2fe8e49ba9b

# Quickstart and developer notes

- Based on and following env best practices from https://github.com/paulrberg/solidity-template
- Following power user patterns from https://github.com/boringcrypto/dictator-dao
- Relies on https://github.com:chimera-defi/hardhat-framework for network configs, flattener tasks and common utils
- Pre-run checks:

```
npm run-script prettier
npm run-script lint:sol
npx hardhat compile
```

- To deploy

```
npx hardhat run --network goerli deploy/deploy_common_1.js
```

# Motivation

- Abstract away as much of deployment script functionality as possible to allow the dev to focus on the contracts
- Inherit as much stuff as possible to easily add new networks
- Powerful descriptive deploys
- that track total expenditure for reimbursements
- Deploy duration
- Verify contracts on etherscan automatically at end
- Output steps done
- Allow declarative syntax for full system state setup including things like token distributions and multisig ownership transfers
- Steps output can be easily turned into a readme for users pointing to contracts with links and description of everything done
- Log output written to file system can be used to pick up broken deploys (TODO: Need a better/automatic way to resume broken deploys)

Most of this is based on my experience setting up new contracts for SharedStake. Do with it what you will.

# Errors

A note on errors
To reduce bytecode size and gas costs, error strings are shortened following UNIv3 as an example.  
The template is: {origin contract}:reason  
Common reasons:

```
CBL0 - contract balance will be less than 0 after this operation
VL0 - Value less than or equal to 0 and needs to be greater than 0
VLC - Value less than cap or check amount
AGC - Amount greater than cap or some stored value or requirement
NA - No Access / Not allowed
AE - Already exists
0AD - 0 address
```
