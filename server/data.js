const categorySamples = [
  ['Gift Boxes','Double Perfume Gift Box – J. Janan, Fogg, Suit, Watch & Wallet',7999,'GW-GB-001'],
  ['Frames & Wall Art','Customized Acrylic Photo Frame – Transparent',699,'GW-FW-002'],
  ['Nikkah & Islamic','Customized Nikkah Nama Folder – Luxury Velvet Folder',2899,'GW-NI-001'],
  ['Jewellery','Customized Name Plate Bracelet – Rolex Style',1999,'GW-JW-001'],
  ['Accessories','Customized Long Wallet Gift Set with Pencil',2749,'GW-AC-001'],
  ['Mugs & Bottles','Personalised Magic Mug',1499,'GW-MB-001'],
  ['Pens & Journals','Customize Wooden Diary with Free Pen',1499,'GW-PJ-003'],
  ['Home & Decor','GiftWALA Home & Decor Collection',999,'GW-HD-001'],
  ['Bags & Apparel','Personalised Cotton Tote Bag',1499,'GW-BA-002'],
  ["Men's Shawls",'Swati Woolen Shawl Cream',2099,'GW-MS-006'],
  ['Cotton Unstitched Suits','Rasha Soft Cotton Unstitched Suit – Sage Green',3199,'GW-CS-023'],
  ['Wash N Wear Unstitched Suits','Junaid Jamshed Italian Boski Wash & Wear Unstitched Suit – Blush Pink',2499,'GW-WW-001']
];
const products = categorySamples.map(([category,name,price,sku]) => ({ category, name, price, salePrice: price, sku, stock: 20, featured: true, description: `A thoughtful GiftWALA pick from ${category}. Personalised and packed with care.` }));
const reviews = [
  { name:'Ayesha K.', rating:5, comment:'The attention to detail was beyond perfect. It felt like they knew exactly what I wanted to say.', verified:true },
  { name:'Hassan R.', rating:5, comment:'The box looked even better than the pictures and arrived beautifully packed.', verified:true },
  { name:'Maham S.', rating:5, comment:'Fast replies, lovely quality and the custom name detail was perfect.', verified:true }
];
module.exports = { products, reviews };
