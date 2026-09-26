const express = require('express');
const { Product, Review, Order } = require('./models');
const router = express.Router();

router.get('/categories', async (_req,res) => {
  const categories = await Product.distinct('category');
  res.json(categories);
});
router.get('/products', async (req,res) => {
  const filter = req.query.category ? { category:req.query.category } : {};
  const products = await Product.find(filter).sort({ featured:-1, createdAt:-1 });
  res.json(products);
});
router.get('/products/:id', async (req,res) => {
  const product = await Product.findById(req.params.id);
  if (!product) return res.status(404).json({ message:'Product not found' });
  res.json(product);
});
router.get('/reviews', async (_req,res) => res.json(await Review.find().sort({ createdAt:-1 })));
router.post('/reviews', async (req,res) => res.status(201).json(await Review.create(req.body)));
router.post('/orders', async (req,res) => {
  const { customer, items, paymentMethod='cod' } = req.body;
  if (!customer?.name || !customer?.phone || !customer?.address || !items?.length) return res.status(400).json({ message:'Customer and order details are required' });
  const total = items.reduce((sum,item)=>sum + Number(item.price || 0) * Number(item.quantity || 1),0);
  const order = await Order.create({ customer, items, total, paymentMethod });
  res.status(201).json(order);
});
router.get('/orders/:id', async (req,res) => {
  const order = await Order.findById(req.params.id);
  if (!order) return res.status(404).json({ message:'Order not found' });
  res.json(order);
});
module.exports = router;
