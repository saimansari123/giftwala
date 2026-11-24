const mobileViewport = matchMedia('(max-width: 850px)');
const drawer = document.createElement('dialog');
drawer.id = 'mobile-navigation';
drawer.className = 'mobile-navigation';
drawer.setAttribute('aria-labelledby', 'mobile-navigation-title');
drawer.innerHTML = `
  <div class="mobile-navigation-heading">
    <h2 id="mobile-navigation-title">Menu</h2>
    <button type="button" aria-label="Close menu" autofocus>×</button>
  </div>
  <nav aria-label="Main navigation"></nav>
`;
document.body.append(drawer);

const links = drawer.querySelector('nav');
let opener;

document.addEventListener('click', event => {
  const button = event.target.closest('.site-header .menu-btn, .site-header .mobile-burger');
  if (!button || !mobileViewport.matches || drawer.open) return;
  const nav = button.closest('.site-header').querySelector('.desktop-nav');
  if (!nav) return;

  event.preventDefault();
  event.stopImmediatePropagation();
  opener = button;
  button.setAttribute('aria-controls', drawer.id);
  button.setAttribute('aria-expanded', 'true');
  links.replaceChildren(...Array.from(nav.querySelectorAll(':scope > a:not(.nav-highlight), :scope > .nav-dropdown'), item => {
    if (item.matches('a')) return item.cloneNode(true);
    const category = item.querySelector(':scope > a').cloneNode(true);
    const subcategories = item.querySelectorAll('.dropdown-menu a');
    if (!subcategories.length) return category;

    const group = document.createElement('details');
    const label = document.createElement('summary');
    label.textContent = category.textContent;
    category.textContent = 'All categories';
    group.append(label, category, ...Array.from(subcategories, link => link.cloneNode(true)));
    return group;
  }));
  drawer.showModal();
}, true);

drawer.querySelector('button').addEventListener('click', () => drawer.close());
drawer.addEventListener('click', event => {
  if (event.target === drawer || event.target.closest('nav a')) drawer.close();
});
drawer.addEventListener('close', () => opener?.setAttribute('aria-expanded', 'false'));
mobileViewport.addEventListener('change', () => {
  if (!mobileViewport.matches && drawer.open) drawer.close();
});
