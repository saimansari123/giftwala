const mongoose = require('mongoose');

const productSchema = new mongoose.Schema({
  imageName: String, imageUrl: String, images: { type: [String], default: [] }, name: { type: String, required: true }, sku: { type: String, unique: true },
  category: { type: String, required: true }, price: Number, salePrice: Number,
  stock: { type: Number, default: 0 }, description: String, featured: Boolean
}, { timestamps: true });

const reviewSchema = new mongoose.Schema({
  name: { type: String, required: true }, rating: { type: Number, min: 1, max: 5, default: 5 },
  comment: { type: String, required: true }, verified: { type: Boolean, default: false }
}, { timestamps: true });

const orderSchema = new mongoose.Schema({
  customer: { name: String, phone: String, email: String, address: String, city: String },
  items: [{ productId: mongoose.Schema.Types.ObjectId, name: String, price: Number, quantity: Number, customization: String }],
  total: Number, status: { type: String, default: 'pending', enum: ['pending', 'confirmed', 'packed', 'shipped', 'delivered', 'cancelled'] },
  paymentMethod: { type: String, default: 'cod' }
}, { timestamps: true });

const categorySchema = new mongoose.Schema({ name: { type: String, unique: true, required: true, trim: true } }, { timestamps: true });
const settingsSchema = new mongoose.Schema({ key: { type: String, unique: true, required: true }, value: mongoose.Schema.Types.Mixed }, { timestamps: true });

module.exports = { Product: mongoose.model('Product', productSchema), Review: mongoose.model('Review', reviewSchema), Order: mongoose.model('Order', orderSchema), Category: mongoose.model('Category', categorySchema), Settings: mongoose.model('Settings', settingsSchema) };
