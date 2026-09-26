require('dotenv').config();
const mongoose = require('mongoose');

async function start() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('MongoDB connected successfully ✅');
    await mongoose.connection.close();
  } catch (error) {
    console.error('MongoDB connection failed ❌');
    console.error(error.message);
    process.exitCode = 1;
  }
}

start();
