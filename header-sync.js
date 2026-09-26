document.addEventListener('DOMContentLoaded',()=>{
  if(!document.querySelector('.whatsapp-float')){const w=document.createElement('a');w.className='whatsapp-float';w.href='https://wa.me/923010746622';w.target='_blank';w.rel='noopener';w.innerHTML='<span>Chat on WhatsApp</span>';document.body.appendChild(w)}
  const existingLogo=document.querySelector('.site-header > .brand');
  if(existingLogo){existingLogo.href='/';existingLogo.addEventListener('click',e=>{e.preventDefault();window.location.assign('/')});}
  document.querySelectorAll('.site-header').forEach(header=>{
    if(location.pathname==='/'||location.pathname.endsWith('/index.html')) return;
    header.innerHTML=`<a class="brand" href="/" aria-label="GiftWALA home"></a><nav class="desktop-nav"><a href="/">Home</a><a href="/all-shop.html">All Shop</a><a href="/customize.html">Build your box</a><a href="/categories.html">Categories</a><a href="/how-it-works.html">How it works</a><a href="/reviews.html">Reviews</a><a href="/order-status.html">Track order</a><a href="/about.html">About</a><a href="/contact.html">Contact</a></nav><div class="header-actions"><a class="icon-btn" href="/?openSearch=1" aria-label="Search"></a><a class="icon-btn cart-trigger" href="/" aria-label="Cart"></a><button class="menu-btn" aria-label="Open menu">menu</button></div>`;
    header.querySelector('.menu-btn').onclick=()=>header.querySelector('.desktop-nav').classList.toggle('open');
  });
});
