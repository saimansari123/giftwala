(() => {
  const q = new URLSearchParams(location.search);
  const sku = q.get('sku') || q.get('product');
  if (!q.get('id') && sku) {
    q.set('id', sku);
    location.replace(location.pathname + '?' + q.toString());
  }
})();
