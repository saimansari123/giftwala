document.addEventListener('DOMContentLoaded',()=>{
  const addButtons=()=>document.querySelectorAll('.all-shop .product-card').forEach(card=>{
    if(card.querySelector('.mobile-add-cart'))return;
    const btn=document.createElement('button');
    btn.type='button';btn.className='mobile-add-cart';btn.textContent='Add to cart';
    btn.addEventListener('click',e=>{e.stopPropagation();const name=card.querySelector('h3')?.textContent.trim()||'Gift';const price=Number((card.querySelector('.price')?.textContent||'0').replace(/[^0-9.]/g,''))||0;const cart=JSON.parse(localStorage.getItem('giftwalaCart')||'[]');const item=cart.find(x=>x.name===name);if(item)item.qty=(item.qty||1)+1;else cart.push({id:name,name,price,qty:1});localStorage.setItem('giftwalaCart',JSON.stringify(cart));btn.textContent='Added';btn.classList.add('added');setTimeout(()=>{btn.textContent='Add to cart';btn.classList.remove('added')},1400)});
    card.querySelector('.product-info')?.appendChild(btn);
  });
  addButtons();new MutationObserver(addButtons).observe(document.getElementById('products')||document.body,{childList:true,subtree:true});
});
