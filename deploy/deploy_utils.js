const hre = require("hardhat");
const fs = require("fs");
const hhf = require("@chimera-defi/hardhat-framework");
const {ethers} = hre;
const got = require("got");

const log = txt => {
  txt = txt + "\n";
  console.log(txt);
  fs.writeFileSync("log.txt", txt, {flag: "a"});
};

const ethLaunchNetworks = ["rinkeby", "goerli", "mainnet", "ropsten"];

const getGwei = num => ethers.utils.parseUnits(`${num}`, "gwei");

// some behaviours need to be tested with a mainnet fork which behaves the same as mainnet
const isMainnet = launchNetwork => launchNetwork == "localhost" || launchNetwork == "mainnet";

const isEthereum = launchNetwork => ethLaunchNetworks.indexOf(launchNetwork) != -1;

const isMatic = launchNetwork => launchNetwork == "mumbai" || launchNetwork == "matic";

const getExplorer = async () => {
  let cid = await hre.getChainId();
  let explorer = hhf.explorer(cid);
  return explorer;
};

const getGasPrice = async confidenceMin => {
  let url = "https://api.blocknative.com/gasprices/blockprices";
  let opts = {
    Authorization: process.env.BLOCKNATIVE,
    json: true,
  };
  let res = await got(url, opts);
  let estimatedPrices = res.body.blockPrices[0].estimatedPrices.filter(obj => obj.confidence >= confidenceMin);
  let lowest = estimatedPrices[estimatedPrices.length - 1];

  return {
    maxPriorityFeePerGas: getGwei(lowest.maxPriorityFeePerGas),
    maxFeePerGas: getGwei(lowest.maxFeePerGas),
  };
};

const getMediumGas = async () => {
  return await getGasPrice(80);
};

const getGasViaZapper = async (network = "polygon", type = "instant") => {
  let reqUrl = `https://api.zapper.fi/v1/gas-price?api_key=96e0cc51-a62e-42ca-acee-910ea7d2a241&network=${network}`;

  let res = await got(reqUrl, {json: true});
  return res.body[type];
};

const getGasViaPolygonscan = async () => {
  let apikey = process.env.POLYGONSCAN_API;
  let reqUrl = `https://api.polygonscan.com/api?module=gastracker&action=gasoracle&apikey=${apikey}`;

  let res = await got(reqUrl, {json: true});
  // return res.body.result['ProposeGasPrice'];
  return res.body.result["FastGasPrice"];
};

const _getOverrides = async (launchNetwork = false) => {
  let netConfig = hre.config.networks[launchNetwork];

  if (launchNetwork && !isEthereum(launchNetwork)) {
    let netConfig = hre.config.networks[launchNetwork];
    if (typeof netConfig.gasPrice == "number") return {gasPrice: netConfig.gasPrice};
    if (isMatic(launchNetwork)) {
      let gp = await getGasViaPolygonscan();
      if (gp < 100) gp = 100;
      return {gasPrice: getGwei(gp)};
    }
    return {};
  }
  const overridesForEIP1559 = {
    type: 2,
    maxFeePerGas: getGwei(10),
    maxPriorityFeePerGas: getGwei(3),
    gasLimit: 10000000,
  };
  if (launchNetwork == "mainnet") {
    let {maxFeePerGas, maxPriorityFeePerGas} = await getMediumGas();
    overridesForEIP1559.maxFeePerGas = maxFeePerGas;
    overridesForEIP1559.maxPriorityFeePerGas = maxPriorityFeePerGas;
  } else {
    const gasPrice = await hre.ethers.provider.getGasPrice();
    overridesForEIP1559.maxFeePerGas = gasPrice;
  }
  if (overridesForEIP1559.maxFeePerGas.lt(overridesForEIP1559.maxPriorityFeePerGas))
    overridesForEIP1559.maxPriorityFeePerGas = overridesForEIP1559.maxFeePerGas.sub(1);

  return overridesForEIP1559;
};

const _verifyBase = async (contract, launchNetwork, cArgs = []) => {
  try {
    await hre.run("verify:verify", {
      address: contract.address,
      constructorArguments: cArgs,
      network: launchNetwork,
    });
    log(`Verified ${JSON.stringify(contract)} on network: ${launchNetwork} with constructor args ${cArgs.join(", ")}`);
    log("\n");
    return true;
  } catch (e) {
    log(`Etherscan verification failed w/ ${e} | Args: ${cArgs} | on ${launchNetwork} for ${contract.address}`);
    return false;
  }
};

const _verify = async (contract, launchNetwork, cArgs) => {
  if (!launchNetwork || launchNetwork == "hardhat") return;
  await new Promise(resolve => setTimeout(resolve, 10000));
  await _verifyBase(contract, launchNetwork, cArgs);
};

const _deployContract = async (name, launchNetwork = false, cArgs = []) => {
  if (typeof cArgs !== "undefined" && (!Array.isArray(cArgs) && Object.keys(cArgs).length > 0)) cArgs = [cArgs];
  log(`Attempting to deploy ${name} - ${cArgs?.length ? cArgs.join(",") : cArgs}`);

  const overridesForEIP1559 = await _getOverrides(launchNetwork);
  const factory = await hre.ethers.getContractFactory(name);
  const contract = await factory.deploy(...cArgs, overridesForEIP1559);
  await contract.deployTransaction.wait(1);
  await contract.deployed();

  log(`\nDeployed ${name} to ${contract.address} on ${launchNetwork} w/ args: ${cArgs.join(",")}`);
  return Promise.resolve({contract: contract, args: cArgs, initialized: false, srcName: name});
};

function chunkArray(array, size) {
  if (array.length <= size) {
    return [array];
  }
  return [array.slice(0, size), ...chunkArray(array.slice(size), size)];
}

const _verifyAll = async (allContracts, launchNetwork) => {
  log("starting _verifyAll");
  if (!launchNetwork || (!isEthereum(launchNetwork) && !isMatic(launchNetwork))) return;
  if (isMatic(launchNetwork)) {
    // hot swap the etherscan api key
    hre.config.etherscan.apiKey = process.env.POLYGONSCAN_API;
  }
  log("Waiting 10s to make sure everything has propagated on etherscan");
  await new Promise(resolve => setTimeout(resolve, 20000));
  // wait 10s to make sure everything has propagated on etherscan

  let contractArr = [],
    verifyAttemtLog = {};
  Object.keys(allContracts).forEach(k => {
    let obj = allContracts[k];
    let contractMin = {
      address: obj.contract.address,
      args: obj.args,
      initialized: obj.initialized,
      name: k,
    };
    contractArr.push(contractMin);
    verifyAttemtLog[k] = contractMin;
  });

  contractArr = chunkArray(contractArr, 5);
  let verificationsPassed = 0;
  let verificationsFailed = 0;

  for (const arr of contractArr) {
    await Promise.all(
      arr.map(async contract => {
        log(`Verifying ${JSON.stringify(contract)} at ${contract.address} `);
        let res = await _verifyBase(contract, launchNetwork, contract.initialized ? [] : contract.args);
        res ? verificationsPassed++ : verificationsFailed++;
        verifyAttemtLog[contract.name].verifified = res;
      }),
    );
    log("Waiting 2 s for Etherscan API limit of 5 calls/s");
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  fs.writeFileSync("verify_attempt_log.json", JSON.stringify(verifyAttemtLog));
  log(`Verifications finished: ${verificationsPassed} / ${verificationsFailed + verificationsPassed} `);
};

const _deployInitializableContract = async (name, launchNetwork = false, initArgs = []) => {
  const overridesForEIP1559 = await _getOverrides(launchNetwork);
  const {contract, _} = await _deployContract(name, launchNetwork, []);
  if (initArgs.length > 0) {
    await contract.initialize(...initArgs, overridesForEIP1559);
  } else {
    await contract.initialize(initArgs, overridesForEIP1559);
  }
  log(`Initialized ${name} with ${initArgs.toString()} \n`);
  return Promise.resolve({contract: contract, args: initArgs, initialized: true, srcName: name});
};

const _getAddress = obj => {
  return obj == undefined || obj.contract == undefined
    ? "0x0000000000000000000000000000000000000000"
    : obj.contract.address;
};

const _postRun = async (contracts, launchNetwork) => {
  log("\n\nDeployment finished. Contracts deployed: \n\n");
  let prefix = "https://";
  let explorer = await getExplorer();
  if (explorer) {
    prefix = explorer;
    prefix += "/address/";
  } else {
    if (isEthereum(launchNetwork)) {
      if (!isMainnet(launchNetwork)) {
        prefix += `${launchNetwork}.`;
      }
      prefix += "etherscan.io/address/";
    }
  }

  Object.keys(contracts).map(k => {
    let address = contracts[k].contract.address;
    let url = prefix + address;
    log(`${k} deployed to ${address} at ${url} `);
  });
  fs.writeFileSync("deploy_log.json", JSON.stringify(contracts), {flag: "a"});
};

const _sendTokens = async (contract, name, to, amount) => {
  let res = await _transact(contract.transfer, to, amount);
  log(`Tokens transferred: From ${contract.address} to ${name} at ${to} : ${amount}`);
  return res;
};

const _transferOwnership = async (name, contract, to) => {
  let res = await _transact(contract.transferOwnership, to);
  log(`Ownership transferred for ${name} at ${contract.address} to ${to}`);
  return res;
};

const _transact = async (tx, ...args) => {
  if (!overrides) overrides = await _getOverrides();
  let trace = await tx(...args, overrides);
  await trace.wait(); // throws on tx failure
  return trace;
};

const _getContract = (contracts, name) => {
  return contracts[name].contract;
};

async function advanceTimeAndBlock(time, ethers) {
  await advanceTime(time, ethers);
  await advanceBlock(ethers);
}

async function advanceTime(time, ethers) {
  await ethers.provider.send("evm_increaseTime", [time]);
}

async function advanceBlock(ethers) {
  await ethers.provider.send("evm_mine");
}

async function loadContract(name, address, signer) {
  let abi = require(`../data/abi/${name}`);
  return new ethers.Contract(address, abi, signer);
}

async function generateJSONListForAutoUI(contracts) {
  let res = {};
  let cid = await hre.getChainId();
  Object.keys(contracts).forEach(name => {
    res[name] = {
      TITLE: name,
      LOGO: "🏆🚀",
      ABI: name,
      VAULT_TYPE: "experimental",
      ADDR: _getAddress(contracts[name]),
      CHAIN_ID: cid,
    };
  });
  return res;
}

class DeployHelper {
  constructor(multisig_address) {
    this.contracts = {};
    this.launchNetwork = hre.network.name;
    this.initialBalance = 0;
    this.currentBlockTime = 0;
    this.distribution = {};
    this.multisig_address = multisig_address;
    this.signer = null;
  }

  async init() {
    let account = hre.config.networks[this.launchNetwork].accounts;
    let privkey = hre.config.networks[this.launchNetwork].accounts[0];
    if (typeof account == "object" && account.mnemonic) {
      privkey = ethers.Wallet.fromMnemonic(account.mnemonic).privateKey;
    }
    this.signer = new hre.ethers.Wallet(privkey, hre.ethers.provider);
    this.address = this.signer.address;

    if (!this.multisig_address) this.multisig_address = this.address; // testing helper

    this.initialBalance = await hre.ethers.provider.getBalance(this.address);
    this.currentBlockTime = (await hre.ethers.provider.getBlock()).timestamp;
    log(
      `Initial balance of deployer at ${this.address} is: ${this.initialBalance.toString()} at block timestamp : ${
        this.currentBlockTime
      }`,
    );
  }

  async deployContract(name, ctrctName, args = []) {
    this.contracts[name] = await _deployContract(ctrctName, this.launchNetwork, args);
  }

  async deployInitializableContract(name, ctrctName, args) {
    this.contracts[name] = await _deployInitializableContract(ctrctName, this.launchNetwork, args);
  }

  addressOf(name) {
    return _getAddress(this.contracts[name]);
  }

  async getOverrides() {
    return await _getOverrides(this.launchNetwork);
  }

  async transact(tx, ...args) {
    let overrides = await this.getOverrides();
    log(`transact ${tx} ${overrides}, ${args.length}, ${[...args].length}`);
    let trace = await tx(...args, overrides);
    await trace.wait(); // throws on tx failure
    return trace;
  }

  async addContract(name, contractName, address, args) {
    this.contracts[name] = {
      contract: await loadContract(contractName, address, this.signer),
    };
    if (args.length > 0) {
      this.contracts[name].initialized = false;
      this.contracts[name].args = args;
    } else {
      this.contracts[name].initialized = true;
      this.contracts[name].args = [];
    }
  }

  _log(msg) {
    log(msg);
  }

  // Token distro
  addDist(name, amount) {
    this.distribution[name] = amount;
  }

  getContract(name) {
    return _getContract(this.contracts, name);
  }

  async _checkEnoughTokensToDistribute(token) {
    let total = Object.values(this.distribution).reduce((a, b) => a.add(b));
    let diff = (await this.getContract(token).balanceOf(this.address)).sub(total);
    if (diff !== 0) {
      log(`Distribution difference: ${diff.toString()}`);
      if (isMainnet(this.launchNetwork) && diff < 0) {
        throw "Not enough total balance";
      }
    }
  }

  async sendTokens(contract, name, to, amount) {
    let res = await this.transact(contract.transfer, to, amount);
    log(`Tokens transferred: From ${contract.address} to ${name} at ${to} : ${amount}`);
    return res;
  }

  async distribute(token) {
    await this._checkEnoughTokensToDistribute(token);
    for (let name in this.distribution) {
      await this.sendTokens(this.getContract(token), name, this.addressOf(name), this.distribution[name]);
    }
  }

  // ownership transfer
  async transferOwnershipToMultisig(name) {
    let to = this.multisig_address;
    let contract = this.getContract(name);
    let res = await this.transact(contract.transferOwnership, to);
    log(`Ownership transferred for ${name} at ${contract.address} to ${to}`);
    return res;
  }
  async transferOwnershipToMultisigMultiple(arrOfNames) {
    for (let name of arrOfNames) {
      await this.transferOwnershipToMultisig(name);
    }
  }

  async verify() {
    await _verifyAll(this.contracts, this.launchNetwork);
  }

  async postRun() {
    await _postRun(this.contracts, this.launchNetwork);
    let finalBalance = await hre.ethers.provider.getBalance(this.address);
    let finalBlockTime = (await hre.ethers.provider.getBlock()).timestamp;
    let overrides = await this.getOverrides(this.launchNetwork);
    log(
      `Total cost of deploys: ${this.initialBalance.sub(finalBalance).toString()} with gas settings: ${JSON.stringify(
        overrides,
      )}. Took ${finalBlockTime - this.currentBlockTime} seconds`,
    );
    await this.verify();
    log(JSON.stringify(await generateJSONListForAutoUI(this.contracts)));
  }
}

async function deployUsingClass(name, args) {
  let dh = new DeployHelper();
  await dh.init();
  await dh.deployContract(name, name, args);
  await dh.postRun();
}

function deploySingleContract(name, args) {
  deployUsingClass(name, args)
    .then(() => process.exit(0))
    .catch(error => {
      console.error(error);
      process.exit(1);
    });
}

module.exports = {
  _deployInitializableContract: _deployInitializableContract,
  _deployContract: _deployContract,
  _getAddress: _getAddress,
  _verify: _verify,
  _verifyAll: _verifyAll,
  _postRun: _postRun,
  _getOverrides: _getOverrides,
  log: log,
  isMainnet: isMainnet,
  _transact: _transact,
  _sendTokens: _sendTokens,
  _transferOwnership: _transferOwnership,
  _getContract: _getContract,
  advanceTimeAndBlock: advanceTimeAndBlock,
  DeployHelper: DeployHelper,
  deploySingleContract: deploySingleContract,
};
