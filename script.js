// Keep the homepage product request small enough to load reliably; full catalog routes remain unchanged.
if (location.pathname === '/' || location.pathname === '/index.html') {
  const originalFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const url = typeof input === 'string' ? input : input?.url;
    if (url && url.includes('/api/products') && !url.includes('home=1')) {
      const separator = url.includes('?') ? '&' : '?';
      input = url + separator + 'home=1';
    }
    return originalFetch(input, init);
  };
}
// SAFE-FIX (2026-11-25): the live catalogue comes ONLY from /api/products.
// The old hardcoded demo products (Memory Box Rs. 2,850 etc.) were shown
// whenever the API was slow or failed, so customers saw fake products and
// fake prices. products now starts empty and the grid shows a loading /
// error state until the API answers (see renderCatalog / loadAllData).
// SECURITY-FIX (2026-11-25): escaping-only helpers. Product, category
// and review text comes from the API (admin-entered or visitor-entered)
// and is written into the page with innerHTML in several places below,
// so every such value passes through escHtml (element text) or escAttr
// (attribute values) first, and image URLs through safeImgSrc. No
// behaviour change — same markup, escaped values. p.bg is a hardcoded
// palette literal and money() output is numeric, so neither needs it.
function escHtml(v){return String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;')}
function escAttr(v){return escHtml(v)}
function safeImgSrc(url){const s=String(url??'').trim();if(!s||/["'<>]/.test(s)||/^\s*(javascript|vbscript|data:text\/html)\s*:/i.test(s))return '';return s}
// SECURITY-FIX (2026-11-25): the quick-add, mobile Add to cart and
// remove buttons used to carry product ids in inline onclick="..."
// handlers — an id with a quote could break out of the handler string.
// Ids now travel in data attributes and this one delegated listener calls
// addToCart / removeFromCart (both are hoisted function declarations).
// The mobile button keeps its exact old feedback: "Added to bag" for
// 1400ms, then back to "Add to cart".
document.addEventListener('click',e=>{const buy=e.target.closest('[data-buy-now]');if(buy){e.preventDefault();e.stopPropagation();buyNow(buy.dataset.buyNow);return}const add=e.target.closest('[data-add-to-cart]');if(add){e.stopPropagation();addToCart(add.dataset.addToCart);if(add.classList.contains('mobile-add-cart')){add.textContent='Added to bag';add.classList.add('added');setTimeout(()=>{add.textContent='Add to cart';add.classList.remove('added')},1400)}return}const rem=e.target.closest('[data-remove-from-cart]');if(rem){removeFromCart(rem.dataset.removeFromCart)}});
let products=[];
const sheetCategories=[{name:'Gift Boxes',icon:'',desc:'Ready-to-gift hampers',sample:['Double Perfume Gift Box  J. Janan, Fogg, Suit, Watch & Wallet',7999,'Gift Boxes']},{name:'Frames & Wall Art',icon:'',desc:'Memories on your wall',sample:['Customized Acrylic Photo Frame  Transparent',699,'Frames & Wall Art']},{name:'Nikkah & Islamic',icon:'',desc:'Meaningful milestones',sample:['Customized Nikkah Nama Folder  Luxury Velvet Folder',2899,'Nikkah & Islamic']},{name:'Jewellery',icon:'',desc:'Names they can wear',sample:['Customized Name Plate Bracelet  Rolex Style',1999,'Jewellery']},{name:'Accessories',icon:'',desc:'Personal everyday pieces',sample:['Customized Long Wallet Gift Set with Pencil',2749,'Accessories']},{name:'Mugs & Bottles',icon:'',desc:'Made for their routine',sample:['Personalised Magic Mug',1499,'Mugs & Bottles']},{name:'Pens & Journals',icon:'',desc:'For thoughts & plans',sample:['Customize Wooden Diary with Free Pen',1499,'Pens & Journals']},{name:'Home & Decor',icon:'',desc:'Little touches of home',sample:null},{name:'Bags & Apparel',icon:'',desc:'Wear your story',sample:['Personalised Cotton Tote Bag',1499,'Bags & Apparel']},{name:"Men's Shawls",icon:'',desc:'Seasonal essentials',sample:['Swati Woolen Shawl Cream',2099,"Men's Shawls"]},{name:'Cotton Unstitched Suits',icon:'',desc:'Soft seasonal cotton',sample:['Rasha Soft Cotton Unstitched Suit  Sage Green',3199,'Cotton Unstitched Suits']},{name:'Wash N Wear Unstitched Suits',icon:'',desc:'Classic Italian Boski',sample:['Junaid Jamshed Italian Boski Wash & Wear Unstitched Suit  Blush Pink',2499,'Wash N Wear Unstitched Suits']}];
// DESIGN (2026-11-25): category tiles use the real card images in
// assets/category_cards_148x125/ (owner-provided). Only files that exist are
// listed — there is no perfumes.jpg, so an unmapped category falls back to a
// product photo in renderCategoryImages instead of a broken image.
const categoryCardImages={"Gift Boxes":"gift-boxes.jpg","Frames & Wall Art":"frames.jpg","Nikkah & Islamic":"nikkah.jpg","Jewellery":"jewellery.jpg","Accessories":"accessories.jpg","Mugs & Bottles":"mugs.jpg","Pens & Journals":"pens-journals.jpg","Home & Decor":"home-decor.jpg","Bags & Apparel":"bags-apparel.jpg","Men's Shawls":"mens-shawls.jpg","Cotton Unstitched Suits":"cotton-suits.jpg","Wash N Wear Unstitched Suits":"wash-wear.jpg","Hoodies":"graphic-hoodies.jpg"};
function categoryTileImage(name){const f=categoryCardImages[name];return f?`<img src="/assets/category_cards_148x125/${f}" alt="${escAttr(name)}" loading="lazy" decoding="async">`:''}
// SAFE-FIX (2026-11-25): catalogue samples are no longer pushed into
// products — same demo-data problem as above. sheetCategories still drives
// the navigation and category tiles; the products themselves come from the API.
let apiLoaded=false,apiCategories=[],apiLoading=true,apiLoadError=false;
let cart=JSON.parse(localStorage.getItem('giftwalaCart')||'[]');let activeFilter=new URLSearchParams(window.location.search).get('category')||'All';const grid=document.getElementById('productGrid');
function persistCart(){const value=JSON.stringify(Array.isArray(cart)?cart:[]);localStorage.setItem('giftwalaCart',value);localStorage.setItem('giftwala_checkout_cart',value)}
function money(n){return 'Rs. '+n.toLocaleString('en-PK')}
// DESIGN (2026-11-25): skeleton cards replace the blank 'Loading gifts…' text.
function skeletonHTML(n){let out='';for(let i=0;i<(n||8);i++){out+='<article class="product-card skeleton-card" aria-hidden="true"><div class="product-image skeleton-block"></div><div class="product-info"><div class="skeleton-line skeleton-line--title"></div><div class="skeleton-line"></div><div class="skeleton-line skeleton-line--price"></div></div></article>'}return out}
function imageSrc(url){if(!url)return '';const m=url.match(/\/d\/([^/]+)/);return m?`https://drive.google.com/thumbnail?id=${m[1]}&sz=w900`:url}
function render(){let list=products.filter(p=>activeFilter==='All'||p.cat===activeFilter);const sort=document.getElementById('sortSelect').value;if(sort==='low')list.sort((a,b)=>a.price-b.price);if(sort==='high')list.sort((a,b)=>b.price-a.price);grid.innerHTML=list.map(p=>`<article class="product-card"><div class="product-image" style="background:${p.bg}"><span class="badge">${escHtml(p.tag)}</span><button class="quick-add" type="button" data-add-to-cart="${escAttr(p.id)}"><svg class="gw-icon " viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14"/><path d="M5 12h14"/></svg></button>${p.imageUrl?`<img class="product-photo" src="${escAttr(safeImgSrc(imageSrc(p.imageUrl)))}" alt="${escAttr(p.name)}" loading="lazy">`:`<div class="product-art">${escHtml(p.art)}</div>`}</div><div class="product-info"><h3>${escHtml(p.name)}</h3><p>${escHtml(p.desc)}</p><span class="price">${money(p.price)}</span></div></article>`).join('')||(apiLoadError?'<p>Could not load our gifts right now. Please refresh the page or try again in a moment.</p>':(apiLoading?skeletonHTML(8):'<p>No gifts found - try another occasion.</p>'))}
function setFilter(f){activeFilter=f;document.querySelectorAll('.filter-row button').forEach(b=>b.classList.toggle('active',b.dataset.filter===f));render();document.getElementById('shop').scrollIntoView({behavior:'smooth',block:'start'})}
function openCategory(f){location.href=`/all-shop.html?category=${encodeURIComponent(f)}`}
function addToCart(id){const p=products.find(x=>x.id===id);const item=cart.find(x=>x.id===id);if(item)item.qty++;else cart.push({...p,qty:1});persistCart();updateCart();toast(`${p.name} added to your bag`)}
/* ROUND 20: Buy Now checks out just this one item — the saved bag is
   left untouched. The item travels in sessionStorage so the cart-sync
   intervals on the homepage cannot overwrite it before checkout loads. */
function buyNow(id){const p=products.find(x=>String(x.id)===String(id));if(!p)return;const item={id:p.id,sku:p.sku,name:p.name,price:Number(p.salePrice||p.price||0),qty:1,imageUrl:p.imageUrl||''};try{sessionStorage.setItem('giftwala_buy_now',JSON.stringify([item]));localStorage.setItem('giftwala_checkout_cart',JSON.stringify([item]))}catch(e){}location.href='/checkout.html'}
function updateCart(){const count=cart.reduce((a,x)=>a+x.qty,0);const countEl=document.getElementById('cartCount'),itemsEl=document.getElementById('cartTotalItems'),totalEl=document.getElementById('cartTotal'),cartEl=document.getElementById('cartItems');if(countEl)countEl.textContent=count;if(itemsEl)itemsEl.textContent=`(${count})`;if(totalEl)totalEl.textContent=money(cart.reduce((a,x)=>a+x.price*x.qty,0));if(cartEl)cartEl.innerHTML=cart.length?cart.map(x=>`<div class="cart-line"><div class="thumb">${escHtml(x.art)}</div><div><h4>${escHtml(x.name)}</h4><p>${money(x.price)} - Qty ${x.qty}</p><button type="button" data-remove-from-cart="${escAttr(x.id)}">Remove</button></div></div>`).join(''):'<div class="empty-cart">Your bag is waiting for something lovely </div>'}
document.getElementById('categoryNav').innerHTML=sheetCategories.map(c=>`<a href="/all-shop.html?category=${encodeURIComponent(c.name)}" data-filter="${escAttr(c.name)}">${escHtml(c.name)}</a>`).join('');document.getElementById('categoryTiles').innerHTML=sheetCategories.map(c=>`<a href="/all-shop.html?category=${encodeURIComponent(c.name)}" data-filter="${escAttr(c.name)}"><span class="category-image">${categoryTileImage(c.name)}</span><b>${escHtml(c.name)}</b><small>${escHtml(c.desc)}</small></a>`).join('');document.getElementById('filterRow').insertAdjacentHTML('beforeend',sheetCategories.map(c=>`<button data-filter="${escAttr(c.name)}">${escHtml(c.name)}</button>`).join(''));const categoryToggle=document.querySelector('.nav-dropdown>a');categoryToggle.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();categoryToggle.parentElement.classList.toggle('category-open')});document.querySelectorAll('.desktop-nav>a,.dropdown-menu a').forEach(link=>link.addEventListener('click',()=>{categoryToggle.parentElement.classList.remove('category-open');document.querySelector('.desktop-nav').classList.remove('open')}));
let carouselIndex=0;const carouselSlides=[...document.querySelectorAll('.carousel-slide')],carouselDots=[...document.querySelectorAll('#carouselDots button')];function showSlide(i){carouselIndex=(i+carouselSlides.length)%carouselSlides.length;carouselSlides.forEach((s,n)=>s.classList.toggle('active',n===carouselIndex));carouselDots.forEach((d,n)=>d.classList.toggle('active',n===carouselIndex))}const nextBtn=document.getElementById('nextSlide'),prevBtn=document.getElementById('prevSlide');if(nextBtn)nextBtn.onclick=()=>showSlide(carouselIndex+1);if(prevBtn)prevBtn.onclick=()=>showSlide(carouselIndex-1);carouselDots.forEach((d,n)=>d.onclick=()=>showSlide(n));if(carouselSlides.length)setInterval(()=>showSlide(carouselIndex+1),5000);
async function loadAllData(){if(apiLoaded)return;apiLoaded=true;try{const [pRes,cRes,rRes]=await Promise.all([fetch('/api/products'),fetch('/api/categories'),fetch('/api/reviews')]);const remote=await pRes.json();const categories_data=await cRes.json();const reviews=await rRes.json();apiLoading=false;if(Array.isArray(remote)&&remote.length){products=remote.map((p,i)=>({id:p.sku||`db-${i}`,sku:p.sku,name:p.name,desc:p.description||p.category,price:p.salePrice||p.price,originalPrice:p.price,salePrice:p.salePrice,stock:p.stock,cat:p.category,art:'',imageUrl:p.imageUrl||p.cardImage||`/assets/products/${p.sku}${(p.imageName||'').toLowerCase().endsWith('.jpg')?'.jpg':'.png'}`,tag:'GiftWALA',bg:['#e9e6e1','#e7e4df','#e3ddd2','#e8e5e0'][i%4]}));renderCatalog()}if(Array.isArray(categories_data)&&categories_data.length){apiCategories=categories_data;updateCategoryNav()}if(window.GWReviews){GWReviews.renderReviewsInto({grid:document.getElementById('homeReviewGrid'),empty:document.getElementById('homeReviewsEmpty'),summary:document.getElementById('homeReviewSummary'),verified:reviews||[],pending:[],limit:3})}else{const quote=document.querySelector('.testimonial blockquote');const reviewer=document.querySelector('.reviewer');if(reviews?.length&&quote){quote.textContent=`${reviews[0].comment}`;reviewer.innerHTML=`- ${escHtml(reviews[0].name)} <span>Verified buyer</span>`}}renderCatalog();afterProductsLoaded()}catch(error){console.info('API loading fallback');apiLoading=false;apiLoadError=true;renderCatalog()}}function updateCategoryNav(){if(!Array.isArray(apiCategories)||!apiCategories.length)return;const nav=document.getElementById('categoryNav'),tiles=document.getElementById('categoryTiles');if(nav)nav.innerHTML=apiCategories.map(c=>`<a href="/all-shop.html?category=${encodeURIComponent(c)}" data-filter="${escAttr(c)}">${escHtml(c)}</a>`).join('');if(tiles)tiles.innerHTML=apiCategories.map(c=>`<a href="/all-shop.html?category=${encodeURIComponent(c)}" data-filter="${escAttr(c)}"><span class="category-image">${categoryTileImage(c)}</span><b>${escHtml(c)}</b><small>GiftWALA collection</small></a>`).join('')}window.addEventListener('giftwala:categories-updated',()=>{apiLoaded=false;loadAllData()});loadAllData();
function removeFromCart(id){cart=cart.filter(x=>String(x.id)!==String(id));persistCart();updateCart()}
function openCart(){document.getElementById('cartDrawer').classList.add('open');document.getElementById('overlay').classList.add('show')};function closeCart(){document.getElementById('cartDrawer').classList.remove('open');document.getElementById('overlay').classList.remove('show')};function toast(msg){const t=document.getElementById('toast');t.textContent=msg;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),2400)}
document.querySelectorAll('#filterRow button[data-filter]').forEach(el=>el.addEventListener('click',e=>{e.preventDefault();setFilter(el.dataset.filter)}));document.getElementById('sortSelect').addEventListener('change',()=>renderCatalog());document.getElementById('cartBtn').onclick=openCart;document.getElementById('closeCart').onclick=closeCart;document.getElementById('overlay').onclick=closeCart;document.getElementById('filterBtn').onclick=()=>document.getElementById('filterRow').classList.toggle('show');/* ROUND 20 (G1): the ONE WhatsApp fallback for the bag. It only sends
   the order as a message — the real checkout is checkout.html. Bill
   is subtotal + flat Rs. 300 delivery (no discount: the 15% prepaid
   discount only applies when a prepaid method is chosen at checkout). */
document.getElementById('checkoutBtn').onclick=()=>{if(!cart.length)return toast('Add a gift to your bag first');const sub=cart.reduce((s,x)=>s+Number(x.price||0)*Number(x.qty||1),0),del=cart.length?300:0,lines=cart.map((x,i)=>(i+1)+'. '+x.name+' | Qty: '+(x.qty||1)+' | '+money(Number(x.price||0)*(x.qty||1))+[x.person?'Name: '+x.person:'',x.photo?'Photo: '+x.photo:'',x.frameSize?'Frame: '+x.frameSize:'',x.size?'Size: '+x.size:'',x.occasion?'Occasion: '+x.occasion:'',x.note?'Note: '+x.note:''].filter(Boolean).join(' | ')).join('\n');window.open('https://wa.me/923010746622?text='+encodeURIComponent('*NEW GIFTWALA ORDER*\n\n'+lines+'\n\nProducts subtotal: '+money(sub)+'\nDelivery charges: '+money(del)+'\n*Total: '+money(sub+del)+'*\n\nPlease confirm this order.'),'_blank')};
/* ROUND 20: the single "Proceed to Checkout" path from the bag. */
document.getElementById('proceedCheckoutBtn')?.addEventListener('click',()=>{if(!cart.length)return toast('Add a gift to your bag first');persistCart();location.href='/checkout.html'});document.getElementById('subscribeForm')?.addEventListener('submit',e=>{e.preventDefault();toast('Youre on the list - welcome to GiftWALA ');e.target.reset()});document.getElementById('menuBtn').onclick=function(){const nav=document.querySelector('.desktop-nav');const open=nav.classList.toggle('open');this.setAttribute('aria-expanded',String(open));this.setAttribute('aria-label',open?'Close menu':'Open menu')};render();
// Category pages: keep each category on its own shareable URL.
window.addEventListener('popstate',()=>setFilter(new URLSearchParams(window.location.search).get('category')||'All'));
document.querySelectorAll('a[data-filter]').forEach(el=>el.addEventListener('click',e=>{e.preventDefault();openCategory(el.dataset.filter)}));
function catalogCard(p){
  const stock=Number.isFinite(Number(p.stock))?Number(p.stock):null;
  const pct=discountPercent(p);
  const isPersonalised=/personal|custom/i.test((p.name||'')+' '+(p.desc||''));
  const wished=isWishlisted(p.id);
  const stockLabel=stock===null?'':stock===0?'<span class="stock-label out">Out of stock</span>':stock<=5?'<span class="stock-label low">Only '+stock+' left \u2014 order soon</span>':'<span class="stock-label">In stock - '+stock+' available</span>';
  const heartSvg='<svg class="gw-icon " viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>';
  return '<article class="product-card" data-product-id="'+escAttr(p.id)+'"><div class="product-image" style="background:'+p.bg+'"><span class="badge">'+escHtml(p.tag)+'</span>'+(isPersonalised?'<span class="personalised-tag">Personalised</span>':'')+(pct?'<span class="discount-badge">-'+pct+'%</span>':'')+'<button class="quick-add" type="button" aria-label="Add to bag" data-add-to-cart="'+escAttr(p.id)+'"><svg class="gw-icon " viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14"/><path d="M5 12h14"/></svg></button><button type="button" class="wish-btn'+(wished?' saved':'')+'" data-wishlist-toggle="'+escAttr(p.id)+'" aria-label="Save to wishlist" aria-pressed="'+(wished?'true':'false')+'">'+heartSvg+'</button>'+(p.imageUrl?'<img class="product-photo" src="'+escAttr(safeImgSrc(imageSrc(p.imageUrl)))+'" alt="'+escHtml(p.name)+'" loading="lazy" decoding="async">':'<div class="product-art">'+escHtml(p.art)+'</div>')+'</div><div class="product-info"><h3>'+escHtml(p.name)+'</h3><p>'+escHtml(p.desc)+'</p>'+stockLabel+'<span class="price">'+money(p.salePrice||p.price)+'</span>'+(p.salePrice&&Number(p.salePrice)<Number(p.price)?'<del class="old-price">'+money(p.price)+'</del>':'')+'<span class="delivery-line">Cash on delivery \u00b7 Delivery Rs. 300</span><button class="mobile-add-cart" type="button" data-add-to-cart="'+escAttr(p.id)+'">Add to cart</button><button class="buy-now-btn" type="button" data-buy-now="'+escAttr(p.id)+'">Buy Now</button></div></article>';
}
let activeBudget=null;let activeBudgetLabel='';
function renderCatalog(){const sort=document.getElementById('sortSelect')?.value||'featured';let source=[...products];if(activeBudget){source=source.filter(p=>{const pr=Number(p.salePrice||p.price||0);return pr>=activeBudget.min&&(activeBudget.max===null||pr<activeBudget.max)})}if(!source.length){grid.className='product-grid';grid.innerHTML=apiLoadError?'<p>Could not load our gifts right now. Please refresh the page or try again in a moment.</p>':skeletonHTML(8);return}if(sort==='low')source.sort((a,b)=>a.price-b.price);if(sort==='high')source.sort((a,b)=>b.price-a.price);if(activeFilter!=='All'){const list=source.filter(p=>p.cat===activeFilter);grid.className='product-grid';grid.innerHTML=list.map(catalogCard).join('')||'<p>No gifts found.</p>';return}// SAFE-FIX (2026-11-25): each product is shown ONCE. The old code put the
// first 4 products under 'All Products' and then again under their own
// category section. Empty sections are dropped entirely.
// DESIGN (2026-11-25): homepage shows ONE featured section only (Bestsellers,
// first 8 distinct products). The old code rendered up to 13 sections
// ('All Products' + one per category) with the same products repeated.
// Category browsing still lives in the category tiles + All Shop.
const seen=new Set();const featured=source.filter(p=>{const k=String(p.sku||p.id);if(seen.has(k))return false;seen.add(k);return true}).slice(0,8);grid.className='catalog-sections';grid.innerHTML=`<section class="catalog-section featured-section"><div class="catalog-section-head"><div><p class="eyebrow">GIFTWALA BESTSELLERS</p><h3>Bestsellers</h3></div><a class="featured-view-all" href="/all-shop.html">View all products <svg class="gw-icon gw-icon--arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12h16"/><path d="M14 6l6 6-6 6"/></svg></a></div><div class="product-grid">${featured.map(catalogCard).join('')}</div></section>`}
render=renderCatalog;renderCatalog();
document.addEventListener('click',e=>{const link=e.target.closest('.catalog-view-all');if(link){e.preventDefault();openCategory(link.dataset.filter)}});
function discountPercent(p){const original=Number(p.originalPrice||p.price||0),sale=Number(p.price||0);return original>sale&&sale>0?Math.round((original-sale)/original*100):0}
/* DESIGN (2026-11-25): catalogCard is defined once above — the old second
   definition dropped the real stock label and the Add to cart button. */
renderCatalog();
document.addEventListener('click',e=>{const card=e.target.closest('.product-card[data-product-id]');if(card&&!e.target.closest('button'))window.location.href=`/product.html?id=${encodeURIComponent(card.dataset.productId)}`});
document.addEventListener('error',e=>{const img=e.target;if(!img.matches||!img.matches('.product-photo'))return;if(!img.dataset.retried){const sku=(img.src.match(/products\/([^/.]+)/)||[])[1];const p=products.find(x=>x.sku===sku);if(p?.remoteUrl){img.dataset.retried='1';img.src=imageSrc(p.remoteUrl);return}}img.style.display='none'},true);
function renderProductCarousel(){const slides=[...document.querySelectorAll('.carousel-slide')];if(!slides.length||!products.length)return;products.slice(0,3).forEach((p,i)=>{const slide=slides[i];if(!slide)return;slide.innerHTML=`<div class="carousel-art product-carousel-art" style="background:${p.bg}">${p.imageUrl?`<img class="product-photo" src="${escAttr(safeImgSrc(p.imageUrl))}" alt="${escAttr(p.name)}" loading="lazy">`:`<span>${escHtml(p.art||'')}</span>`}</div><div class="carousel-copy"><small>0${i+1} / 03 - GIFTWALA PICK</small><h3>${escHtml(p.name)}</h3><p>${escHtml(p.desc)}</p><strong>${money(p.price)}</strong><a href="/?category=${encodeURIComponent(p.cat)}#shop" class="text-link">Shop this gift <svg class="gw-icon gw-icon--arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12h16"/><path d="M14 6l6 6-6 6"/></svg></a></div>`})}
function renderCategoryImages(){const tiles=[...document.querySelectorAll('#categoryTiles>a')];tiles.forEach(tile=>{const span=tile.querySelector('span');if(!span)return;const file=categoryCardImages[tile.dataset.filter];if(file){span.innerHTML=`<img src="/assets/category_cards_148x125/${file}" alt="${escAttr(tile.dataset.filter)}" loading="lazy" decoding="async">`}else{const p=products.find(x=>x.cat===tile.dataset.filter);if(p)span.innerHTML=p.imageUrl?`<img src="${escAttr(safeImgSrc(p.imageUrl))}" alt="${escAttr(p.cat)}" loading="lazy" decoding="async">`:escHtml(p.art||'')}span.classList.add('category-image')})}
renderCategoryImages();document.addEventListener('click',e=>{const a=e.target.closest('#categoryTiles a');if(a){e.preventDefault();openCategory(a.dataset.filter)}});
renderProductCarousel();
/* DESIGN (2026-11-25): categoryCardImages moved to the top of this file so
   tiles render with the real card image on first paint, not after a timeout. */
// SAFE-FIX (2026-11-25): removed the 2800ms duplicate re-render — it re-rendered the catalogue a second time for no reason.
// SAFE-FIX (2026-11-25): removed the 3200ms duplicate re-fetch + re-render.
 // loadAllData() already loads the catalogue once; this second fetch could
 // return a different order and visibly swap products/prices after load.
const pageLinks={Shop:'/',Categories:'/categories.html','How it works':'/how-it-works.html',Reviews:'/reviews.html',About:'/about.html',Contact:'/contact.html'};document.querySelectorAll('.desktop-nav>a').forEach(a=>{const href=pageLinks[a.textContent.trim()];if(href)a.href=href});
/* DESIGN (2026-11-25): removed — it overwrote the real frames.jpg tile with a product photo. */
fetch('/api/categories').then(r=>r.json()).then(names=>{if(!Array.isArray(names)||!names.length)return;const old=new Map(sheetCategories.map(c=>[c.name,c]));sheetCategories.splice(0,sheetCategories.length,...names.map(name=>old.get(name)||({name,icon:'',desc:'GiftWALA collection',sample:null})));const nav=document.getElementById('categoryNav'),tiles=document.getElementById('categoryTiles'),filters=document.getElementById('filterRow');if(nav)nav.innerHTML=sheetCategories.map(c=>`<a href="/all-shop.html?category=${encodeURIComponent(c.name)}" data-filter="${escAttr(c.name)}">${escHtml(c.name)}</a>`).join('');if(tiles)tiles.innerHTML=sheetCategories.map(c=>`<a href="/all-shop.html?category=${encodeURIComponent(c.name)}" data-filter="${escAttr(c.name)}"><span class="category-image">${categoryTileImage(c.name)}</span><b>${escHtml(c.name)}</b><small>${escHtml(c.desc)}</small></a>`).join('');if(filters){filters.querySelectorAll('[data-filter]:not(:first-child)').forEach(x=>x.remove());filters.insertAdjacentHTML('beforeend',sheetCategories.map(c=>`<button data-filter="${escAttr(c.name)}">${escHtml(c.name)}</button>`).join(''))}document.querySelectorAll('a[data-filter]').forEach(el=>el.onclick=e=>{e.preventDefault();openCategory(el.dataset.filter)});document.querySelectorAll('#filterRow button[data-filter]').forEach(el=>el.onclick=e=>{e.preventDefault();setFilter(el.dataset.filter)});renderCatalog()}).catch(()=>{});
document.addEventListener('DOMContentLoaded',()=>{const nav=document.querySelector('.desktop-nav'),drop=nav?.querySelector('.nav-dropdown'),toggle=drop?.querySelector(':scope > a');if(!drop||!toggle)return;toggle.setAttribute('aria-expanded','false');toggle.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();const open=drop.classList.toggle('category-open');toggle.setAttribute('aria-expanded',String(open));});drop.querySelector('.dropdown-menu')?.addEventListener('click',e=>{if(e.target.closest('a')){drop.classList.remove('category-open');toggle.setAttribute('aria-expanded','false');}});const style=document.createElement('style');style.textContent='@media(max-width:850px){.desktop-nav .nav-dropdown{display:block!important;width:100%!important}.desktop-nav .nav-dropdown>a{display:flex!important;align-items:center!important;justify-content:space-between!important;cursor:pointer!important}.desktop-nav .nav-dropdown>a .nav-chevron{flex:none;margin-left:auto;transition:transform .25s ease}.desktop-nav .nav-dropdown.category-open>a .nav-chevron{transform:rotate(180deg)}.desktop-nav .nav-dropdown .dropdown-menu{display:block!important;width:100%!important;max-height:0!important;height:auto!important;overflow:hidden!important;opacity:0!important;visibility:hidden!important;padding:0!important;margin:0!important;border-left:1px solid #dba83d!important;background:#fff!important;transform:none!important;transition:max-height .35s ease,opacity .25s ease,visibility .25s ease,padding .35s ease!important}.desktop-nav .nav-dropdown.category-open .dropdown-menu{max-height:560px!important;opacity:1!important;visibility:visible!important;padding:4px 0!important}.desktop-nav .nav-dropdown .dropdown-menu a{display:flex!important;min-height:42px!important;align-items:center!important;padding:11px 14px!important;border-bottom:1px solid #e3ddd2!important;background:#fff!important;color:#2c2721!important;font-size:12px!important}.desktop-nav .nav-dropdown .dropdown-menu a:hover,.desktop-nav .nav-dropdown .dropdown-menu a:active{padding-left:20px!important;background:#fff8e9!important;color:#9a7414!important}}';document.head.appendChild(style)});
/* DESIGN (2026-11-25): removed cleanCartButtonSymbols — buttons now carry inline SVG
   icons, so there is no "->" text left to strip. */
window.getGiftwalaProducts=()=>products;
document.addEventListener('click',e=>{const title=e.target.closest('.product-card[data-product-id] h3');if(!title)return;const card=title.closest('.product-card');const p=products.find(x=>String(x.id)===String(card.dataset.productId));if(p)window.location.href='/product.html?id='+encodeURIComponent(p.sku||p.id)});
document.addEventListener('DOMContentLoaded',()=>{const toggle=document.querySelector('.nav-dropdown>a'),drop=toggle?.parentElement;if(!toggle||!drop)return;toggle.addEventListener('click',e=>{e.preventDefault();e.stopImmediatePropagation();const open=drop.classList.toggle('category-open');toggle.setAttribute('aria-expanded',String(open));},true)});
document.addEventListener('DOMContentLoaded',()=>{const clean=v=>String(v||'').replace(/â€“|â€”|Â|&nbsp;/g,' ').replace(/\s+/g,' ').trim();document.querySelectorAll('.product-card h3,.product-card p,.product-card .product-info').forEach(el=>{el.childNodes.forEach(n=>{if(n.nodeType===3)n.textContent=clean(n.textContent)});if(el.children.length===0)el.textContent=clean(el.textContent)})});
fetch('/api/category-settings').then(r=>r.json()).then(map=>Object.entries(map||{}).forEach(([name,url])=>{if(!url)return;document.querySelectorAll('#categoryTiles>a').forEach(a=>{if(a.dataset.filter===name){const s=a.querySelector('span');if(s)s.innerHTML='<img src="'+escAttr(safeImgSrc(url))+'" alt="'+escAttr(name)+'" loading="lazy">'}})})).catch(()=>{});
setInterval(()=>{if(typeof cart!=='undefined')localStorage.setItem('giftwalaCart',JSON.stringify(cart))},500);
fetch('/api/category-descriptions').then(r=>r.json()).then(map=>Object.entries(map||{}).forEach(([name,desc])=>{document.querySelectorAll('#categoryTiles>a').forEach(a=>{if(a.dataset.filter===name){const s=a.querySelector('small');if(s)s.textContent=desc}})})).catch(()=>{});

// DESIGN (2026-11-25): Escape closes menu, search and cart drawer.
document.addEventListener('keydown',e=>{if(e.key!=='Escape')return;document.querySelector('.desktop-nav')?.classList.remove('open');document.getElementById('searchPanel')?.classList.remove('open');if(typeof closeCart==='function')closeCart()});
// DESIGN (2026-11-25): subtle scroll-reveal. Classes are added by JS only, so
// content stays visible if JS fails; reduced-motion users never get the class.
(function(){if(window.matchMedia('(prefers-reduced-motion: reduce)').matches||!('IntersectionObserver' in window))return;const io=new IntersectionObserver(es=>es.forEach(en=>{if(en.isIntersecting){en.target.classList.add('in-view');io.unobserve(en.target)}}),{threshold:.1});document.querySelectorAll('.gw-hero,.category-strip,.shop-section,.custom-banner,.testimonial,.trust-badges').forEach(el=>{el.classList.add('reveal');io.observe(el)})})();

/* HERO SHOWCASE (2026-11-25, round 11): the rotating photo carousel is gone —
   the hero is now a static showcase collage (bestseller + frame + Nikkah, all
   plain links to their product pages, plus an order card). Only the subtle
   desktop mouse-move parallax on the glow remains. Reduced-motion users get
   none of it. */
(function(){
  var hero=document.querySelector('.gw-hero');
  if(!hero) return;
  if(window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  if(!window.matchMedia('(min-width:851px) and (pointer:fine)').matches) return;
  var raf=null;
  hero.addEventListener('mousemove',function(e){
    if(raf) return;
    raf=requestAnimationFrame(function(){
      raf=null;
      var r=hero.getBoundingClientRect();
      hero.style.setProperty('--px',(((e.clientX-r.left)/r.width)-.5).toFixed(3));
      hero.style.setProperty('--py',(((e.clientY-r.top)/r.height)-.5).toFixed(3));
    });
  });
  hero.addEventListener('mouseleave',function(){hero.style.setProperty('--px','0');hero.style.setProperty('--py','0');});
})();

/* GIFT FINDER, BUDGET TILES, DEAL OF THE DAY, HERO MIN PRICE, WISHLIST HEARTS
   AND STICKY ORDER BAR (2026-11-25). All guarded: script.js also runs on
   pages without these elements, so every lookup checks for null first. */

// ---- Wishlist (localStorage key shared with wishlist.html) ----
const WISHLIST_KEY='giftwalaWishlist';
function readWishlist(){try{const v=JSON.parse(localStorage.getItem(WISHLIST_KEY)||'[]');return Array.isArray(v)?v:[]}catch(e){return[]}}
function writeWishlist(list){try{localStorage.setItem(WISHLIST_KEY,JSON.stringify(list))}catch(e){}}
function isWishlisted(id){return readWishlist().some(x=>String(x.id)===String(id))}
function syncWishButtons(id,added){
  document.querySelectorAll('[data-wishlist-toggle]').forEach(btn=>{
    const on=String(btn.dataset.wishlistToggle)===String(id)?added:isWishlisted(btn.dataset.wishlistToggle);
    btn.classList.toggle('saved',on);
    btn.setAttribute('aria-pressed',String(on));
  });
}
function toggleWishlist(id){
  const list=readWishlist();
  const idx=list.findIndex(x=>String(x.id)===String(id));
  let added=false;
  if(idx>=0){list.splice(idx,1)}
  else{
    const p=products.find(x=>String(x.id)===String(id));
    if(!p)return;
    list.push({id:p.id,name:p.name,price:Number(p.salePrice||p.price||0),imageUrl:p.imageUrl||'',sku:p.sku||''});
    added=true;
  }
  writeWishlist(list);
  syncWishButtons(id,added);
  toast(added?'Saved to wishlist':'Removed from wishlist');
}
document.addEventListener('click',e=>{
  const btn=e.target.closest('[data-wishlist-toggle]');
  if(!btn)return;
  e.preventDefault();
  e.stopPropagation();
  toggleWishlist(btn.dataset.wishlistToggle);
});

// ---- Gift Finder ----
const FINDER_OCCASION_MAP={
  'Birthday':['Gift Boxes','Mugs & Bottles','Pens & Journals'],
  'Anniversary':['Jewellery','Frames & Wall Art'],
  'Wedding':['Nikkah & Islamic','Gift Boxes'],
  'Eid':['Nikkah & Islamic','Frames & Wall Art'],
  'For Him':['Gift Boxes','Accessories',"Men's Shawls",'Cotton Unstitched Suits','Wash N Wear Unstitched Suits','Hoodies'],
  'For Her':['Jewellery','Bags & Apparel','Mugs & Bottles','Accessories'],
  'Just Because':null
};
const FINDER_RECIPIENT_MAP={
  'For Him':['Gift Boxes','Accessories',"Men's Shawls",'Cotton Unstitched Suits','Wash N Wear Unstitched Suits','Hoodies'],
  'For Her':['Jewellery','Bags & Apparel','Mugs & Bottles','Accessories'],
  'For a Couple':['Gift Boxes','Frames & Wall Art','Nikkah & Islamic'],
  'For a Friend':['Mugs & Bottles','Pens & Journals','Accessories'],
  'For Parents':['Frames & Wall Art',"Men's Shawls",'Cotton Unstitched Suits']
};
function runGiftFinder(){
  const form=document.getElementById('finderForm');
  const results=document.getElementById('finderResults');
  const countEl=document.getElementById('finderCount');
  if(!form||!results||!countEl)return;
  if(!products.length){
    countEl.textContent='Our gifts are still loading \u2014 please try again in a moment.';
    results.innerHTML='';
    return;
  }
  const occ=document.getElementById('finderOccasion')?.value||'Just Because';
  const rec=document.getElementById('finderRecipient')?.value||'For a Friend';
  const budget=document.getElementById('finderBudget')?.value||'';
  const occCats=FINDER_OCCASION_MAP[occ];
  const recCats=FINDER_RECIPIENT_MAP[rec]||[];
  const allowed=new Set(occCats?occCats.filter(c=>recCats.includes(c)):recCats);
  let min=0,max=null;
  if(budget){
    const parts=budget.split('-');
    min=Number(parts[0])||0;
    max=parts[1]===''||parts[1]==null?null:Number(parts[1]);
  }
  const matches=products.filter(p=>allowed.has(p.cat)).filter(p=>{
    const pr=Number(p.salePrice||p.price||0);
    return pr>=min&&(max===null||pr<max);
  });
  countEl.textContent=matches.length?matches.length+' gifts found':'No gifts match \u2014 try a wider budget.';
  results.innerHTML=matches.map(catalogCard).join('');
}
document.getElementById('finderForm')?.addEventListener('submit',e=>{e.preventDefault();runGiftFinder()});
document.querySelectorAll('.occasion-card').forEach(btn=>btn.addEventListener('click',()=>{
  const occ=document.getElementById('finderOccasion');
  if(occ)occ.value=btn.dataset.occasion;
  runGiftFinder();
  document.getElementById('gift-finder')?.scrollIntoView({behavior:'smooth'});
}));

// ---- Budget tiles + chip (activeBudget is declared just above renderCatalog) ----
function ensureBudgetChip(){
  let chip=document.getElementById('budgetChip');
  if(chip)return chip;
  const heading=document.querySelector('.shop-heading');
  if(!heading)return null;
  chip=document.createElement('span');
  chip.id='budgetChip';
  chip.className='budget-chip';
  chip.hidden=true;
  chip.innerHTML='Showing gifts <span id="budgetChipLabel"></span> \u2014 <button type="button" id="budgetChipClear">Clear</button>';
  heading.appendChild(chip);
  chip.querySelector('#budgetChipClear').addEventListener('click',()=>{
    activeBudget=null;
    activeBudgetLabel='';
    updateBudgetChip();
    renderCatalog();
  });
  return chip;
}
function updateBudgetChip(){
  const chip=ensureBudgetChip();
  if(!chip)return;
  if(!activeBudget){chip.hidden=true;return}
  chip.hidden=false;
  const label=chip.querySelector('#budgetChipLabel');
  if(label)label.textContent=activeBudgetLabel||'';
}
document.querySelectorAll('.budget-tile').forEach(btn=>btn.addEventListener('click',()=>{
  const min=Number(btn.dataset.budgetMin||0);
  const maxRaw=btn.dataset.budgetMax;
  const max=maxRaw===''||maxRaw==null?null:Number(maxRaw);
  activeBudget={min:min,max:max};
  activeBudgetLabel=btn.textContent.trim();
  updateBudgetChip();
  renderCatalog();
  document.getElementById('shop')?.scrollIntoView({behavior:'smooth'});
}));

// ---- Deal of the Day (dynamic from products[], static fallback stays if absent) ----
function renderDealOfDay(){
  const box=document.getElementById('dealContent');
  if(!box)return;
  const p=products.find(x=>x.sku==='GW-GB-002'||x.id==='GW-GB-002');
  if(!p)return;
  const sale=Number(p.salePrice||p.price||0);
  const original=Number(p.originalPrice||p.price||0);
  const stock=Number.isFinite(Number(p.stock))?Number(p.stock):null;
  const img=p.imageUrl?safeImgSrc(imageSrc(p.imageUrl)):'';
  const save=original>sale?original-sale:0;
  const stockHtml=stock===null?'':stock===0?'<p class="deal-day__stock">Out of stock</p>':stock<=5?'<p class="deal-day__stock">Only '+stock+' left in stock</p>':'<p class="deal-day__stock">In stock - '+stock+' available</p>';
  box.innerHTML='<div class="deal-day__card">'
    +(img?'<img src="'+escAttr(img)+'" alt="'+escAttr(p.name)+'" loading="lazy">':'')
    +'<div class="deal-day__info"><h3>'+escHtml(p.name)+'</h3>'
    +'<p class="deal-day__price"><span class="deal-price">'+money(sale)+'</span>'+(original>sale?' <del>'+money(original)+'</del>':'')+'</p>'
    +(save?'<p class="deal-day__save">Save '+money(save)+'</p>':'')
    +stockHtml
    +'<div class="deal-day__actions">'
    +(stock===0?'':'<button type="button" class="btn gold" data-add-to-cart="'+escAttr(p.sku||p.id)+'">Add to bag</button>')
    +'<a href="/product.html?id='+encodeURIComponent(p.sku||p.id)+'">View gift box</a></div></div></div>';
}

// ---- Hero minimum price (static "Rs. 349" stays unless the real minimum is lower) ----
function updateHeroMinPrice(){
  const el=document.getElementById('heroMinPrice');
  if(!el||!products.length)return;
  const prices=products.map(p=>Number(p.salePrice||p.price||0)).filter(n=>n>0);
  if(!prices.length)return;
  const min=Math.min.apply(null,prices);
  if(Number.isFinite(min)&&min<349)el.textContent=money(min);
}

// Called once the live catalogue has loaded (hooked into loadAllData).
function afterProductsLoaded(){
  updateHeroMinPrice();
  renderDealOfDay();
  runGiftFinder();
}

// ---- Sticky order bar (mobile only, only after scrolling past the hero) ----
function updateStickyBar(){
  const bar=document.getElementById('stickyOrderBar');
  if(!bar)return;
  const hero=document.querySelector('.gw-hero');
  const text=document.getElementById('stickyOrderText');
  const pastHero=hero?window.scrollY>hero.offsetTop+hero.offsetHeight:false;
  const show=window.innerWidth<=850&&pastHero;
  const count=cart.reduce((a,x)=>a+Number(x.qty||1),0);
  const total=cart.reduce((a,x)=>a+Number(x.price||0)*Number(x.qty||1),0);
  if(text)text.textContent='Your bag: '+count+' item(s) \u2014 '+money(total);
  bar.classList.toggle('visible',show);
  document.body.classList.toggle('sticky-bar-visible',show);
  bar.setAttribute('aria-hidden',String(!show));
}
window.addEventListener('scroll',updateStickyBar,{passive:true});
window.addEventListener('resize',updateStickyBar);
document.getElementById('stickyOrderBtn')?.addEventListener('click',()=>{
  if(cart.length&&typeof openCart==='function')openCart();
  else document.getElementById('shop')?.scrollIntoView({behavior:'smooth'});
});
(function(){
  // Keep the sticky bar text fresh when items are added or removed.
  const _add=addToCart,_rem=removeFromCart;
  addToCart=function(id){_add(id);updateStickyBar()};
  removeFromCart=function(id){_rem(id);updateStickyBar()};
})();
updateStickyBar();
runGiftFinder();
