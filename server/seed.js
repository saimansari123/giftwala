require('dotenv').config();
const mongoose = require('mongoose');
const { Product, Review } = require('./models');
const { reviews } = require('./data');
const products = require('./sheet-products.json');

async function seed(){
  await mongoose.connect(process.env.MONGODB_URI);
  await Product.deleteMany({}); await Review.deleteMany({});
  await Product.insertMany(products); await Review.insertMany(reviews);
  console.log(`Seeded ${products.length} products and ${reviews.length} reviews ✅`);
  await mongoose.disconnect();
}
seed().catch(err=>{ console.error(err.message); process.exit(1); });
