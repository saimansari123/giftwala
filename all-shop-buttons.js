document.addEventListener('DOMContentLoaded',()=>{
  const addButtons=()=>document.querySelectorAll('.all-shop .product-card').forEach(card=>{
    if(card.querySelector('.mobile-add-cart'))return;
    const btn=document.createElement('button');
    btn.type='button';btn.className='mobile-add-cart';btn.textContent='Add to cart';
    btn.addEventListener('click',e=>{e.stopPropagation();btn.textContent='Added';btn.classList.add('added');setTimeout(()=>{btn.textContent='Add to cart';btn.classList.remove('added')},1400)});
    card.querySelector('.product-info')?.appendChild(btn);
  });
  addButtons();new MutationObserver(addButtons).observe(document.getElementById('products')||document.body,{childList:true,subtree:true});
});
