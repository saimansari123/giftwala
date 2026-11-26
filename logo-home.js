document.addEventListener('DOMContentLoaded',()=>{
  if(!document.querySelector('.whatsapp-float')){const w=document.createElement('a');w.className='whatsapp-float';w.href='https://wa.me/923010746622';w.target='_blank';w.rel='noopener';w.setAttribute('aria-label','Chat on WhatsApp');w.innerHTML='<svg class="gw-icon gw-icon--fill wag" viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden="true"><path fill="currentColor" stroke="none" d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z"/></svg>';document.body.appendChild(w)}
  const logo=document.querySelector('.site-header > .brand');
  if(!logo)return;
  logo.href='/';
  logo.innerHTML='';
  logo.addEventListener('click',e=>{e.preventDefault();window.location.assign('/')});
  if(new URLSearchParams(location.search).get('openSearch')==='1')setTimeout(()=>document.getElementById('headerSearchBtn')?.click(),350);
  if(new URLSearchParams(location.search).get('openCart')==='1')setTimeout(()=>document.getElementById('cartBtn')?.click(),350);
  const nav=document.querySelector('.site-header .desktop-nav');
  if(nav&&!nav.querySelector('a[href="/order-status.html"]')){const a=document.createElement('a');a.href='/order-status.html';a.textContent='Track order';nav.appendChild(a)}
  /* ROUND 20: removed the fetch wrapper that rewrote POST
     /api/orders totals client-side (subtotal + 300, no
     discount). The Worker now computes the full breakdown
     server-side and ignores any client-sent total. */

  // SAFE-FIX (2026-11-25): REMOVED the old 1800ms block that hard-coded a
  // 'Delivery charges Rs. 300' row and ran a 700ms interval setting
  // #cartTotal to subtotal+300 even for an EMPTY cart (total showed Rs. 300
  // with nothing in the bag). runtime-stability.js is now the single source
  // of cart math: delivery = items.length ? 300 : 0.
  setTimeout(()=>{const select=document.getElementById('cartPayment');if(!select||document.querySelector('.payment-checkboxes'))return;select.style.display='none';select.closest('.payment-animated-select')?.remove();const wrap=document.createElement('div');wrap.className='payment-checkboxes';wrap.innerHTML=[...select.options].map((o,i)=>`<label class="payment-choice"><input type="radio" name="paymentChoice" value="${o.value}" ${i===0?'checked':''}><span>${o.textContent}</span></label>`).join('');select.parentElement.appendChild(wrap);wrap.querySelectorAll('input').forEach(r=>r.onchange=()=>{select.value=r.value;select.dispatchEvent(new Event('change',{bubbles:true}))})},1500);

});


// Restore cart product rendering if any legacy cart updater replaces it with the empty state.
document.addEventListener('DOMContentLoaded',()=>{const render=()=>{const box=document.getElementById('cartItems');if(!box||typeof cart==='undefined')return;const money=n=>'Rs. '+Number(n||0).toLocaleString('en-PK');box.innerHTML=cart.length?cart.map(x=>{const image=x.imageUrl||((x.sku)?'/assets/products/'+x.sku+((x.imageName||'').toLowerCase().endsWith('.jpg')?'.jpg':'.png'):'');return '<div class="cart-line"><div class="thumb">'+(image?'<img src="'+image+'" alt="'+x.name+'">':(x.art||''))+'</div><div><h4>'+x.name+'</h4><p>'+money(x.price)+' - Qty '+x.qty+'</p><div class="cart-controls"><button onclick="changeCartQty('+JSON.stringify(x.id)+',-1)">−</button><span class="qty">'+x.qty+'</span><button onclick="changeCartQty('+JSON.stringify(x.id)+',1)">+</button><button class="cart-trash" aria-label="Remove item" onclick="removeFromCart('+JSON.stringify(x.id)+')">×</button></div></div></div>'}).join(''):'<div class="empty-cart">Your bag is waiting for something lovely</div>'};setInterval(render,300);render()});
// Reliable cart controls: handle delete and quantity buttons before legacy handlers.
document.addEventListener('DOMContentLoaded',()=>{const box=document.getElementById('cartItems');if(!box)return;box.addEventListener('click',e=>{const btn=e.target.closest('.cart-controls button');if(!btn||typeof cart==='undefined')return;const call=btn.getAttribute('onclick')||'',match=call.match(/(?:changeCartQty|removeFromCart)\(([^,\)]+)/);if(!match)return;const raw=match[1].replace(/["']/g,'').trim(),item=cart.find(x=>String(x.id)===raw);if(!item)return;e.preventDefault();e.stopImmediatePropagation();if(call.includes('removeFromCart')){cart=cart.filter(x=>String(x.id)!==raw)}else{const delta=call.includes(',-1')?-1:1;item.qty=Math.max(1,Number(item.qty||1)+delta)}if(typeof updateCart==='function')updateCart()},true)});
// Include payment method, discount, delivery and final total in WhatsApp checkout.

// Build the WhatsApp order message with a clickable product link for every item.

document.addEventListener('DOMContentLoaded',()=>{if(document.querySelector('.floating-cart'))return;const b=document.createElement('button');b.className='floating-cart';b.type='button';b.setAttribute('aria-label','Open cart');b.innerHTML='<svg class="gw-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" width="22" height="22"><path d="M3 4h2l2.4 12.2a2 2 0 0 0 2 1.8h7.9a2 2 0 0 0 2-1.5L21 8H6"/><circle cx="10" cy="20" r="1.4"/><circle cx="17.5" cy="20" r="1.4"/></svg><em>0</em>';document.body.appendChild(b);const sync=()=>{const n=JSON.parse(localStorage.getItem('giftwalaCart')||'[]').reduce((s,x)=>s+Number(x.qty||1),0);b.querySelector('em').textContent=n};sync();setInterval(sync,500);b.onclick=()=>document.getElementById('cartBtn')?.click()});
// Basic public-site content protection deterrents.
(function(){if(window.__giftwalaProtection)return;window.__giftwalaProtection=true;const editable=e=>/INPUT|TEXTAREA|SELECT/.test(e.target?.tagName||'');document.addEventListener('contextmenu',e=>{if(!editable(e))e.preventDefault()});document.addEventListener('selectstart',e=>{if(!editable(e))e.preventDefault()});document.addEventListener('dragstart',e=>{if(e.target?.tagName==='IMG')e.preventDefault()});document.addEventListener('copy',e=>{if(!editable(e))e.preventDefault()});document.addEventListener('cut',e=>{if(!editable(e))e.preventDefault()});document.addEventListener('keydown',e=>{const k=String(e.key).toLowerCase();if(e.key==='F12'||(e.ctrlKey&&e.shiftKey&&['i','j','c'].includes(k))||(e.ctrlKey&&['u','s','p','c'].includes(k))){if(!editable(e))e.preventDefault()}})})();
