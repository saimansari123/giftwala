require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const path = require('path');
const api = require('./api');
const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors()); app.use(express.json());
app.use(express.static(path.join(__dirname, '..')));
app.get('/', (_req,res)=>res.sendFile(path.join(__dirname, '..', 'index.html')));
app.get('/api/health', (_req,res)=>res.json({ ok:true, service:'GiftWALA API' }));
app.use('/api', api);

mongoose.connect(process.env.MONGODB_URI).then(()=>{
  app.listen(PORT, ()=>console.log(`GiftWALA API running at http://localhost:${PORT}`));
}).catch(err=>{ console.error('MongoDB connection failed:', err.message); process.exit(1); });
