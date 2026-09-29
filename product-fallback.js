(() => {
  setTimeout(async () => {
    const app = document.getElementById('app');
    if (!app || !/Loading product/i.test(app.textContent)) return;
    const id = new URLSearchParams(location.search).get('id');
    if (!id) return;
    try {
      const r = await fetch('/api/products/' + encodeURIComponent(id));
      if (!r.ok) return;
      const p = await r.json();
      const price = Number(p.salePrice ?? p.sale_price ?? p.price ?? 0);
      const image = p.imageUrl || p.image_url || '/assets/products/' + p.sku + '.png';
      app.innerHTML = '<div class="product"><div><div class="hero"><img src="' + image + '" alt="' + p.name + '"></div></div><div class="details"><div class="eyebrow">' + (p.category || 'GiftWALA collection') + '</div><h1>' + p.name + '</h1><p class="subtitle">' + (p.description || 'A thoughtful GiftWALA pick, personalised and packed with care.') + '</p><div class="pricebox"><span class="price">Rs. ' + price.toLocaleString('en-PK') + '</span><span class="stock">● In stock</span></div><button class="primary">ADD TO CART</button></div></div>';
    } catch (_) {}
  }, 1200);
})();
