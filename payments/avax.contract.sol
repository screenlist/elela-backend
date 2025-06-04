// SPDX-License-Identifier: GPL-3.0

pragma solidity  ^0.8.24;

contract ElelaPayments {
  address payable public owner;

  constructor(){
    owner = payable(msg.sender);
  }

  modifier onlyOwner() {
    require(owner == msg.sender, "Not authorised");
    _; 
  }

  event PaymentReceived (
    address indexed sender,
    uint256 amount,
    string invoice
  );

  function makePayment(string calldata _invoice) external payable {
    require(msg.value > 0, "Payment must be greater than 0");
    require(bytes(_invoice).length > 0, "Invoice reference is required");
    (bool sent, ) = owner.call{value: msg.value}("");
    require(sent, "Failed to make payment");
    emit PaymentReceived(msg.sender, msg.value, _invoice);
  }

  function changeOwner(address payable _newOwner) external onlyOwner {
    require(_newOwner != address(0), "Invalid address");
    owner = _newOwner;
  }

  receive() external payable {
    revert("Direct payments not accepted");
  }
}
