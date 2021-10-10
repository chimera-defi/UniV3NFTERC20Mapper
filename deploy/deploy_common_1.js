const constants = require("../constants.js");

async function main() {
  let {DeployHelper} = require("./deploy_utils.js");
  let dh = new DeployHelper();
  await dh.init();
  // rinkeby 
  await dh.deployContract("UniV3NFTERC20Mapper", "UniV3NFTERC20Mapper", ['0x1F98431c8aD98523631AE4a59f267346ea31F984', '0xC36442b4a4522E871399CD717aBDD847Ab11FE88']);

  // deploy smurf erc20 for auto verification
  await dh.deployContract("ERC20Mintable", "ERC20Mintable", ['smurf', 'smurf']);

  await dh.postRun();
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
