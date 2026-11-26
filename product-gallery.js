// SECURITY-FIX (2026-11-25): escaping-only rewrite. The product name and
// image URLs come from the API (admin-entered), so they are escaped for
// their attribute context and image URLs are allow-listed before being
// written with innerHTML. Behaviour is unchanged: poll every 300ms until
// window.current exists, render the main image + thumbnail controls once
// (galleryReady), and switch the main image on thumbnail click.
const escAttr = v => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const safeImg = u => {
  const s = String(u ?? '').trim();
  if (!s || /["'<>]/.test(s) || /^\s*(javascript|vbscript|data:text\/html)\s*:/i.test(s)) return '';
  return s;
};
setInterval(() => {
  const p = window.current, box = document.querySelector('.photo');
  if (!p || !box || box.dataset.galleryReady) return;
  const fallback = `/assets/products/${escAttr(p.sku || p._id || 'product')}.png`;
  const imgs = (Array.isArray(p.images) && p.images.length ? p.images : [p.imageUrl || fallback])
    .map(safeImg).filter(Boolean);
  if (!imgs.length) imgs.push(fallback);
  const name = escAttr(p.name || 'GiftWALA product');
  box.dataset.galleryReady = '1';
  box.innerHTML = `<img class="gallery-main-image" src="${imgs[0]}" alt="${name}">${imgs.length > 1 ? `<div class="gallery-controls">${imgs.map((x, i) => `<button type="button" data-src="${x}" class="${i === 0 ? 'active' : ''}"><img src="${x}" alt="${name} image ${i + 1}" loading="lazy"></button>`).join('')}</div>` : ''}`;
  box.querySelectorAll('.gallery-controls button').forEach(b => b.onclick = () => {
    box.querySelector('.gallery-main-image').src = b.dataset.src;
    box.querySelectorAll('button').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
  });
}, 300);
