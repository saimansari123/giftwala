const express = require('express');
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Product, Review, Order, Category, Settings } = require('./models');
const router = express.Router();
const adminTokens = new Set();
const loginAttempts = new Map();
const adminGuard = (req,res,next)=>{const token=String(req.headers.authorization||'').replace(/^Bearer\s+/i,'');if(!token||!adminTokens.has(token))return res.status(401).json({message:'Admin login required'});next()};
const uploadDir = path.join(__dirname, '..', 'assets', 'uploads');
fs.mkdirSync(uploadDir, { recursive:true });

router.get('/categories', async (_req,res) => {
  const saved = await Category.find().sort({name:1});
  const productCategories = await Product.distinct('category');
  const categories = [...new Set([...saved.map(c=>c.name), ...productCategories])].sort();
  res.json(categories);
});
router.post('/categories', adminGuard, async (req,res) => { const name=String(req.body?.name||'').trim(); if(!name)return res.status(400).json({message:'Category name required'}); try{res.status(201).json(await Category.create({name}))}catch(e){res.status(409).json({message:'Category already exists'})} });
router.patch('/categories/by-name/:old', adminGuard, async (req,res) => { const name=String(req.body?.name||'').trim(); const old=decodeURIComponent(req.params.old); const c=await Category.findOne({name:old}); if(!c)return res.status(404).json({message:'Category not found'}); c.name=name;await c.save();await Product.updateMany({category:old},{$set:{category:name}});res.json(c); });
router.patch('/categories/:id', adminGuard, async (req,res) => { const name=String(req.body?.name||'').trim(); if(!name)return res.status(400).json({message:'Category name required'}); const c=await Category.findById(req.params.id); if(!c)return res.status(404).json({message:'Category not found'}); const old=c.name;c.name=name;await c.save();await Product.updateMany({category:old},{$set:{category:name}});res.json(c); });
router.post('/uploads/image', adminGuard, async (req,res) => {
  const { filename, data } = req.body || {};
  const match=String(data||'').match(/^data:(image\/(png|jpeg|jpg|webp));base64,(.+)$/);
  if (!match) return res.status(400).json({message:'Send a PNG, JPG or WEBP data URL'});
  const ext=match[2]==='jpeg'?'jpg':match[2];
  const safe=String(filename||'upload').replace(/[^a-z0-9_-]/gi,'').slice(0,60)||'upload';
  const finalName=`${Date.now()}-${safe}.${ext}`;
  const buffer=Buffer.from(match[3],'base64');
  if (buffer.length>5*1024*1024) return res.status(413).json({message:'Image must be 5MB or smaller'});
  fs.writeFileSync(path.join(uploadDir,finalName),buffer);
  res.status(201).json({filename:finalName,url:`/assets/uploads/${finalName}`});
});
router.post('/admin/login', async (req,res)=>{const key=req.ip||'unknown';const now=Date.now();const old=loginAttempts.get(key);if(old&&now-old.started<15*60*1000&&old.count>=8)return res.status(429).json({message:'Too many login attempts. Try again later.'});const entry=old&&now-old.started<15*60*1000?old:{started:now,count:0};entry.count++;loginAttempts.set(key,entry);const saved=await Settings.find({key:{$in:['adminEmail','adminPasswordHash']}});const config=Object.fromEntries(saved.map(x=>[x.key,x.value]));const email=String(req.body?.email||'').trim();const password=String(req.body?.password||'');const expectedEmail=config.adminEmail||process.env.ADMIN_EMAIL||'admin@giftwala.pk';const expectedHash=config.adminPasswordHash||crypto.createHash('sha256').update(process.env.ADMIN_PASSWORD||'change-this-password').digest('hex');if(email!==expectedEmail||crypto.createHash('sha256').update(password).digest('hex')!==expectedHash)return res.status(401).json({message:'Invalid admin credentials'});loginAttempts.delete(key);const token=crypto.randomBytes(32).toString('hex');adminTokens.add(token);res.json({token,expiresIn:'session',email})});
router.get('/products', async (req,res) => {
  const filter = req.query.category ? { category:req.query.category } : {};
  const products = await Product.find(filter).sort({ featured:-1, createdAt:-1 });
  res.json(products);
});
router.post('/products', adminGuard, async (req,res) => {
  const { name, sku, category, price, salePrice, stock=0, description='', sizes=[], imageName='', imageUrl='', images=[] }=req.body||{};
  if(!name?.trim()||!sku?.trim()||!category?.trim()||Number(price)<0)return res.status(400).json({message:'Name, SKU, category and valid price are required'});
  const product=await Product.create({name:name.trim(),sku:sku.trim(),category:category.trim(),price:Number(price),salePrice:Number(salePrice||price),stock:Math.max(0,Number(stock)),description,sizes:Array.isArray(sizes)?sizes.map(String):[],imageName,imageUrl,images:Array.isArray(images)?images:[],featured:false});
  res.status(201).json(product);
});
router.get('/products/:id', async (req,res) => {
  const query = mongoose.isValidObjectId(req.params.id) ? { _id:req.params.id } : { sku:req.params.id };
  const product = await Product.findOne(query);
  if (!product) return res.status(404).json({ message:'Product not found' });
  res.json(product);
});
router.patch('/products/:id', adminGuard, async (req,res) => {
  const query = mongoose.isValidObjectId(req.params.id) ? { _id:req.params.id } : { sku:req.params.id };
  const allowed = {};
  if (req.body.name != null) allowed.name=String(req.body.name).trim();
  if (req.body.sku != null) allowed.sku=String(req.body.sku).trim();
  if (req.body.category != null) allowed.category=String(req.body.category).trim();
  if (req.body.description != null) allowed.description=String(req.body.description);
  if (req.body.price != null) allowed.price=Math.max(0,Number(req.body.price));
  if (req.body.salePrice != null) allowed.salePrice=Math.max(0,Number(req.body.salePrice));
  if (req.body.stock != null) allowed.stock=Math.max(0,Math.floor(Number(req.body.stock)));
  if (req.body.featured != null) allowed.featured=Boolean(req.body.featured);
  if (Array.isArray(req.body.sizes)) allowed.sizes=req.body.sizes.map(x=>String(x).trim()).filter(Boolean);
  if (Array.isArray(req.body.images)) { allowed.images=req.body.images; allowed.imageUrl=req.body.images[0]||''; }
  if (!Object.keys(allowed).length) return res.status(400).json({ message:'No editable fields supplied' });
  const product=await Product.findOneAndUpdate(query,allowed,{new:true,runValidators:true});
  if (!product) return res.status(404).json({message:'Product not found'});
  res.json(product);
});
router.delete('/products/:id', adminGuard, async (req,res)=>{const query=mongoose.isValidObjectId(req.params.id)?{_id:req.params.id}:{sku:req.params.id};const p=await Product.findOneAndDelete(query);if(!p)return res.status(404).json({message:'Product not found'});res.json({ok:true,id:p._id});});
router.get('/reviews', async (_req,res) => res.json(await Review.find().sort({ createdAt:-1 })));
router.post('/reviews', async (req,res) => {
  const { name, rating, comment } = req.body || {};
  if (!name?.trim() || !comment?.trim()) return res.status(400).json({ message:'Name and review are required' });
  if (rating != null && (Number(rating) < 1 || Number(rating) > 5)) return res.status(400).json({ message:'Rating must be between 1 and 5' });
  res.status(201).json(await Review.create({ name:name.trim(), rating:Number(rating||5), comment:comment.trim() }));
});
router.patch('/reviews/:id', adminGuard, async (req,res)=>{const allowed={};if(req.body.name!=null)allowed.name=String(req.body.name).trim();if(req.body.comment!=null)allowed.comment=String(req.body.comment).trim();if(req.body.rating!=null)allowed.rating=Math.max(1,Math.min(5,Number(req.body.rating)));if(req.body.verified!=null)allowed.verified=Boolean(req.body.verified);const review=await Review.findByIdAndUpdate(req.params.id,allowed,{new:true,runValidators:true});if(!review)return res.status(404).json({message:'Review not found'});res.json(review)});
router.delete('/reviews/:id', adminGuard, async (req,res)=>{const review=await Review.findByIdAndDelete(req.params.id);if(!review)return res.status(404).json({message:'Review not found'});res.json({ok:true})});
router.post('/orders', async (req,res) => {
  const { customer, items, paymentMethod='cod' } = req.body;
  if (!customer?.name || !customer?.phone || !customer?.address || !items?.length) return res.status(400).json({ message:'Customer and order details are required' });
  if (!/^03\d{9}$/.test(String(customer.phone).replace(/\s+/g,''))) return res.status(400).json({ message:'WhatsApp number must be exactly 11 digits and start with 03' });
  if (!Array.isArray(items) || items.some(item=>!item.name || Number(item.quantity||0)<1 || Number(item.price||0)<0)) return res.status(400).json({ message:'Invalid order items' });
  const total = items.reduce((sum,item)=>sum + Number(item.price || 0) * Number(item.quantity || 1),0);
  const order = await Order.create({ customer, items, total, paymentMethod });
  const phone=String(process.env.WHATSAPP_NUMBER||'923010746622').replace(/\D/g,'');
  const summary=items.map(item=>`${item.name} x${item.quantity||1}`).join(', ');
  const confirmationMessage=`Hi ${customer.name}! Your GiftWALA order ${String(order._id).slice(-8)} has been received. Items: ${summary}. Total: Rs. ${total.toLocaleString('en-PK')}. We will confirm it shortly.`;
  res.status(201).json({ ...order.toObject(), confirmation:{ whatsappUrl:`https://wa.me/${phone}?text=${encodeURIComponent(confirmationMessage)}`, message:confirmationMessage, emailQueued:Boolean(process.env.SMTP_HOST) } });
});
router.get('/orders', adminGuard, async (_req,res) => res.json(await Order.find().sort({createdAt:-1}).limit(200)));
router.get('/admin/customers', adminGuard, async (_req,res)=>{const orders=await Order.find().sort({createdAt:-1});const map=new Map();orders.forEach(o=>{const c=o.customer||{};const key=c.phone||c.email||c.name;if(!key)return;if(!map.has(key))map.set(key,{name:c.name||'-',phone:c.phone||'-',email:c.email||'-',address:c.address||'-',orders:0,total:0,lastOrder:o.createdAt});const x=map.get(key);x.orders++;x.total+=Number(o.total||0)});res.json([...map.values()])});
router.get('/admin/analytics', adminGuard, async (_req,res)=>{const orders=await Order.find();const byStatus={};orders.forEach(o=>{byStatus[o.status]=(byStatus[o.status]||0)+1});const byMonth={};orders.forEach(o=>{const k=new Date(o.createdAt).toISOString().slice(0,7);byMonth[k]=(byMonth[k]||0)+Number(o.total||0)});res.json({byStatus,byMonth,totalOrders:orders.length,totalSales:orders.filter(o=>o.status!=='cancelled').reduce((s,o)=>s+Number(o.total||0),0)})});
router.get('/admin/settings', adminGuard, async (_req,res)=>{const rows=await Settings.find({key:{$ne:'adminPasswordHash'}});res.json(Object.fromEntries(rows.map(x=>[x.key,x.value])))});
router.patch('/admin/settings', adminGuard, async (req,res)=>{const body={...req.body};if(body.adminEmail){body.adminEmail=String(body.adminEmail).trim()}if(body.adminPassword){body.adminPasswordHash=crypto.createHash('sha256').update(String(body.adminPassword)).digest('hex');delete body.adminPassword}for(const [key,value] of Object.entries(body))await Settings.findOneAndUpdate({key},{key,value},{upsert:true,new:true});res.json({ok:true})});
router.get('/admin/stats', adminGuard, async (_req,res)=>{const [products,orders]=await Promise.all([Product.find({},'stock'),Order.find({},'total status customer')]);res.json({products:products.length,stock:products.reduce((n,p)=>n+Number(p.stock||0),0),orders:orders.length,sales:orders.filter(o=>o.status!=='cancelled').reduce((n,o)=>n+Number(o.total||0),0),customers:new Set(orders.map(o=>o.customer?.phone).filter(Boolean)).size})});
router.get('/orders/:id', async (req,res) => {
  const order = await Order.findById(req.params.id);
  if (!order) return res.status(404).json({ message:'Order not found' });
  res.json(order);
});
router.patch('/orders/:id/status', adminGuard, async (req,res) => {
  const statuses=['pending','confirmed','packed','shipped','delivered','cancelled'];
  if (!statuses.includes(req.body?.status)) return res.status(400).json({message:'Invalid order status'});
  const order=await Order.findByIdAndUpdate(req.params.id,{status:req.body.status},{new:true,runValidators:true});
  if (!order) return res.status(404).json({message:'Order not found'});
  res.json(order);
});
module.exports = router;
