const {ethers} = require("hardhat");

let num = int => {
  return ethers.utils.parseEther(int.toString());
};

module.exports = {
  greeting: "hi",
};
