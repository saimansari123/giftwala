document.addEventListener('DOMContentLoaded',()=>{
  if(!document.querySelector('.whatsapp-float')){const w=document.createElement('a');w.className='whatsapp-float';w.href='https://wa.me/923010746622';w.target='_blank';w.rel='noopener';w.innerHTML='<span>Chat on WhatsApp</span>';document.body.appendChild(w)}
  const logo=document.querySelector('.site-header > .brand');
  if(!logo)return;
  logo.href='/';
  logo.addEventListener('click',e=>{e.preventDefault();window.location.assign('/')});
  if(new URLSearchParams(location.search).get('openSearch')==='1')setTimeout(()=>document.getElementById('searchBtn')?.click(),350);
  const nav=document.querySelector('.site-header .desktop-nav');
  if(nav&&!nav.querySelector('a[href="/order-status.html"]')){const a=document.createElement('a');a.href='/order-status.html';a.textContent='Track order';nav.appendChild(a)}
});
