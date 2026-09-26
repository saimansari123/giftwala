require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const path = require('path');
const api = require('./api');
const app = express();
const PORT = process.env.PORT || 5000;
const limits = new Map();
function rateLimit({ windowMs=15*60*1000, max=120 }={}) {
  return (req,res,next)=>{
    const key=`${req.ip||req.socket.remoteAddress||'unknown'}:${req.path}`;
    const now=Date.now();let entry=limits.get(key);
    if(!entry||now-entry.started>windowMs)entry={started:now,count:0};
    entry.count++;limits.set(key,entry);
    if(entry.count>max)return res.status(429).json({message:'Too many requests. Please try again later.'});
    next();
  };
}

app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use((req,res,next)=>{res.setHeader('X-Content-Type-Options','nosniff');next()});
app.use(express.static(path.join(__dirname, '..')));
app.get('/', (_req,res)=>res.sendFile(path.join(__dirname, '..', 'index.html')));
app.get('/api/health', (_req,res)=>res.json({ ok:true, service:'GiftWALA API' }));
app.use('/api', rateLimit({max:180}), api);
app.use((err,_req,res,_next)=>{console.error(err);res.status(err.status||500).json({message:'Something went wrong. Please try again.'})});

mongoose.connect(process.env.MONGODB_URI).then(()=>{
  app.listen(PORT, ()=>console.log(`GiftWALA API running at http://localhost:${PORT}`));
}).catch(err=>{ console.error('MongoDB connection failed:', err.message); process.exit(1); });
