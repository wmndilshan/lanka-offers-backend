const AddressEngine = require('../lib/address-engine');

const testCases = [
  {
    name: "Jetwing Hotels (List)",
    merchant: "Jetwing Hotels",
    text: "Merchant: Jetwing Hotels Discount | Hotel | Location: Valid on Bed & Breakfast, Half Board and Full Board basis (from Rack Rates) \n 40% off at Jetwing Wahawa Walauwa - Rambukkana \n 40% off at Jetwing Colombo Seven \n 35% off at Jetwing Lagoon Wellness - Negombo"
  },
  {
    name: "Amagi Aria (Explicit)",
    merchant: "Amagi Aria",
    text: "Merchant: Amagi Aria, Negombo Location: Negombo Contact No: 0703569178"
  },
  {
    name: "Oak Ray (Embedded)",
    merchant: "Oak Ray Hotels",
    text: "25% for Double Full Board basis at Oak Ray Regency – Kandy, Oak Ray Serene Garden – Kandy, Senani Hotel – Kandy"
  },
  {
    name: "Comma Separated",
    merchant: "KFC",
    text: "Available at Kollupitiya, Nawala, Kandy & Galle branches"
  },
  {
    name: "Address Label",
    merchant: "Pizza Hut",
    text: "Address: 724 Matara Road, Galle, Sri Lanka Tel: 0112729729"
  }
];

console.log("Testing Address Engine:\n");

testCases.forEach(tc => {
  console.log(`--- Case: ${tc.name} ---`);
  const results = AddressEngine.extract(tc.text, tc.merchant);
  console.log(`Input Merchant: ${tc.merchant}`);
  console.log(`Results:`, JSON.stringify(results, null, 2));
  console.log("");
});
