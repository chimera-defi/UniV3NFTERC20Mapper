const constants = require("../constants.js");

async function main() {
  let {DeployHelper} = require("./deploy_utils.js");
  let dh = new DeployHelper();
  await dh.init();
  await dh.deployContract("Greeter", "Greeter", constants.greeting);
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
