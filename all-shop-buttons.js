/* GiftWALA — shared shop helpers (2026-11-25, professional-features pass).
   Loaded on All Shop, product and wishlist pages.
   - "Add to cart" buttons on All Shop product cards (original behaviour kept).
   - Wishlist in localStorage (key: giftwalaWishlist), heart on every
     .product-card, and a Wishlist link with count badge in the site header.
   - No prices or names are invented here: wishlist entries copy the exact
     name/price/image already shown on the card or product page.
   - The header is owned by header-sync.js, which rewrites it on
     DOMContentLoaded; the wishlist link is therefore (re)injected by a
     MutationObserver as well, never by editing header-sync.js. */
(function () {
  'use strict';

  var WISH_KEY = 'giftwalaWishlist';
  var CART_KEY = 'giftwalaCart';

  /* Inline SVG icon system (2026-11-25, owner update): one consistent set —
     24x24 viewBox, stroke currentColor, stroke-width 1.7, round caps/joins.
     No font-glyph icons anywhere in this module. */
  var HEART_OUTLINE = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20.5C7 16.5 3.5 13.3 3.5 9.6 3.5 7 5.5 5 8 5c1.6 0 3.1.8 4 2.1C12.9 5.8 14.4 5 16 5c2.5 0 4.5 2 4.5 4.6 0 3.7-3.5 6.9-8.5 10.9z"/></svg>';
  var HEART_FILLED = '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20.5C7 16.5 3.5 13.3 3.5 9.6 3.5 7 5.5 5 8 5c1.6 0 3.1.8 4 2.1C12.9 5.8 14.4 5 16 5c2.5 0 4.5 2 4.5 4.6 0 3.7-3.5 6.9-8.5 10.9z"/></svg>';

  function readJSON(key) {
    try { var v = JSON.parse(localStorage.getItem(key) || '[]'); return Array.isArray(v) ? v : []; }
    catch (e) { return []; }
  }
  function writeJSON(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {}
  }

  /* ---------- Wishlist ---------- */
  function getWishlist() { return readJSON(WISH_KEY); }
  function isWishlisted(id) {
    return getWishlist().some(function (x) { return String(x.id) === String(id); });
  }
  function toggleWishlist(item) {
    var list = getWishlist();
    var i = list.findIndex(function (x) { return String(x.id) === String(item.id); });
    var added;
    if (i >= 0) { list.splice(i, 1); added = false; }
    else { list.push(item); added = true; }
    writeJSON(WISH_KEY, list);
    syncWishlistUI();
    try { window.dispatchEvent(new Event('giftwala:wishlist-updated')); } catch (e) {}
    return added;
  }
  function wishlistCount() {
    return getWishlist().reduce(function (s, x) { return s + 1; }, 0);
  }
  window.GiftwalaWishlist = {
    get: getWishlist, has: isWishlisted, toggle: toggleWishlist, count: wishlistCount
  };

  /* Header link "Wishlist (n)" — injected into .header-actions. The header
     is rebuilt by header-sync.js, so re-inject whenever it changes. */
  /* ROUND 22 (2026-11-27) — MutationObserver feedback loop (page freeze):
     syncWishlistUI() used to write innerHTML / textContent unconditionally
     on every call, and a body-subtree MutationObserver re-invoked it on
     every mutation — an infinite microtask loop that froze All Shop,
     product and wishlist pages ~1s after load (main thread starved, tab
     unresponsive). Every write below is now conditional: the DOM is only
     touched when the value actually changed, so a sync that changes
     nothing queues no mutations and the loop terminates. A re-entrancy
     guard on the observers (see init) is belt-and-braces. */
  function syncWishlistUI() {
    var n = wishlistCount();
    var ns = String(n);
    document.querySelectorAll('.wishlist-count').forEach(function (el) { if (el.textContent !== ns) el.textContent = ns; });
    document.querySelectorAll('.wishlist-btn').forEach(function (btn) {
      var id = btn.dataset.wishId;
      if (!id) return;
      var on = isWishlisted(id);
      btn.classList.toggle('active', on);
      var pressed = on ? 'true' : 'false';
      if (btn.getAttribute('aria-pressed') !== pressed) btn.setAttribute('aria-pressed', pressed);
      var label = on ? 'Remove from wishlist' : 'Save to wishlist';
      if (btn.getAttribute('aria-label') !== label) btn.setAttribute('aria-label', label);
      /* Compare via a state marker, not innerHTML: serialised innerHTML
         need not equal the assigned string, so a string compare could
         keep "changing" forever. The marker only flips on a real change. */
      var state = on ? 'filled' : 'outline';
      if (btn.dataset.heartState !== state) {
        btn.dataset.heartState = state;
        btn.innerHTML = on ? HEART_FILLED : HEART_OUTLINE;
      }
    });
    var actions = document.querySelector('.site-header .header-actions');
    if (actions && !actions.querySelector('.wishlist-link')) {
      var a = document.createElement('a');
      a.className = 'wishlist-link';
      a.href = '/wishlist.html';
      a.setAttribute('aria-label', 'View your wishlist');
      a.innerHTML = HEART_OUTLINE.replace('width="18" height="18"', 'width="16" height="16"') + ' Wishlist <em class="wishlist-count">' + n + '</em>';
      actions.insertBefore(a, actions.firstChild);
    }
  }

  /* Heart on every product card. Card data comes from the card itself
     (data-* attributes set by the page, or the visible name/price). */
  function cardData(card) {
    var nameEl = card.querySelector('h3');
    var priceEl = card.querySelector('.price');
    var imgEl = card.querySelector('.product-image img, img');
    var priceText = (priceEl && priceEl.textContent) || '';
    var m = priceText.replace(/[^\d.]/g, '').match(/[\d.]+/);
    return {
      id: card.dataset.productId || card.dataset.sku || (nameEl && nameEl.textContent.trim()) || '',
      sku: card.dataset.sku || card.dataset.productId || '',
      name: (nameEl && nameEl.textContent.trim()) || 'Gift item',
      price: m ? Number(m[0]) : 0,
      imageUrl: (imgEl && (imgEl.getAttribute('src') || '')) || ''
    };
  }
  function addHearts(root) {
    (root || document).querySelectorAll('.product-card').forEach(function (card) {
      if (card.querySelector('.wishlist-btn')) return;
      var data = cardData(card);
      if (!data.id) return;
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'wishlist-btn';
      btn.dataset.wishId = data.id;
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        toggleWishlist(cardData(card));
      });
      var imgWrap = card.querySelector('.product-image');
      if (imgWrap) { imgWrap.style.position = 'relative'; imgWrap.appendChild(btn); }
      else { card.appendChild(btn); }
    });
    syncWishlistUI();
  }

  /* ---------- Add to cart (All Shop cards, original behaviour) ---------- */
  function addCartButtons() {
    document.querySelectorAll('.all-shop .product-card').forEach(function (card) {
      if (!card.querySelector('.mobile-add-cart')) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'mobile-add-cart';
      btn.textContent = 'Add to cart';
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var data = cardData(card);
        var cart = readJSON(CART_KEY);
        var item = cart.find(function (x) { return String(x.id) === String(data.id); });
        if (item) item.qty = (item.qty || 1) + 1;
        else cart.push({ id: data.id, sku: data.sku, name: data.name, price: data.price, qty: 1, imageUrl: data.imageUrl });
        writeJSON(CART_KEY, cart);
        try { localStorage.setItem('giftwala_checkout_cart', JSON.stringify(cart)); } catch (err) {}
        btn.textContent = 'Added';
        btn.classList.add('added');
        setTimeout(function () { btn.textContent = 'Add to cart'; btn.classList.remove('added'); }, 1400);
      });
      card.querySelector('.product-info')?.appendChild(btn);
      }
      /* ROUND 20: Buy Now — checks out just this one item; the saved bag
         is left untouched (sessionStorage carries it past the homepage
         cart-sync intervals). */
      if (!card.querySelector('.buy-now-btn')) {
        var buy = document.createElement('button');
        buy.type = 'button';
        buy.className = 'buy-now-btn';
        buy.textContent = 'Buy Now';
        buy.addEventListener('click', function (e) {
          e.stopPropagation();
          var data = cardData(card);
          var item = { id: data.id, sku: data.sku, name: data.name, price: data.price, qty: 1, imageUrl: data.imageUrl };
          try {
            sessionStorage.setItem('giftwala_buy_now', JSON.stringify([item]));
            localStorage.setItem('giftwala_checkout_cart', JSON.stringify([item]));
          } catch (err) {}
          window.location.href = '/checkout.html';
        });
        card.querySelector('.product-info')?.appendChild(buy);
      }
    });
  }

  function init() {
    var style = document.createElement('style');
    style.textContent =
      '.wishlist-btn{position:absolute;top:10px;right:10px;width:36px;height:36px;border-radius:50%;border:1px solid #e3ddd2;background:rgba(255,255,255,.92);color:#9a7414;font-size:18px;line-height:1;cursor:pointer;z-index:3;display:grid;place-items:center;padding:0}' +
      '.wishlist-btn svg{display:block}' +
      '.wishlist-btn.active{background:#9a7414;border-color:#9a7414;color:#fff}' +
      '.wishlist-btn:hover{transform:scale(1.08)}' +
      '.buy-now-btn{display:block;width:100%;margin-top:8px;padding:12px 16px;border:0;border-radius:3px;background:linear-gradient(135deg,#dba83d,#c99125);color:#171513;font-size:12px;font-weight:700;cursor:pointer}' +
      '.site-header .wishlist-link{color:#f1cb73;text-decoration:none;font-size:13px;font-weight:700;white-space:nowrap;display:inline-flex;align-items:center;gap:5px}' +
      '.site-header .wishlist-link svg{display:block}' +
      '.site-header .wishlist-link em{font-style:normal;background:#9a7414;color:#fff;border-radius:999px;min-width:18px;height:18px;display:inline-grid;place-items:center;font-size:11px;padding:0 4px}';
    document.head.appendChild(style);
    addCartButtons();
    addHearts(document);
    syncWishlistUI();
    var target = document.getElementById('products') || document.body;
    /* ROUND 22: re-entrancy guard — a sync triggered by an observer must
       never re-trigger itself while it is still running. */
    var syncing = false;
    function guardedSync() {
      if (syncing) return;
      syncing = true;
      try { syncWishlistUI(); } finally { syncing = false; }
    }
    new MutationObserver(function () { addCartButtons(); addHearts(document); }).observe(target, { childList: true, subtree: true });
    new MutationObserver(guardedSync).observe(document.body, { childList: true, subtree: true });
    window.addEventListener('storage', guardedSync);
    setInterval(guardedSync, 1000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
