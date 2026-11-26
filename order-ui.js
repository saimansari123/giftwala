/* Track Order — SAFE-FIX (2026-11-25).
   The old version replaced the whole <main> of order-status.html with a
   WhatsApp support form, destroying the real order lookup
   (GET /api/orders/<id>). This file now only adds a small WhatsApp help
   link underneath the tracking card, as a secondary option. The lookup
   itself is untouched. */
document.addEventListener('DOMContentLoaded', () => {
  const card = document.querySelector('.tracking-card');
  if (!card || document.querySelector('.order-help-link')) return;
  const help = document.createElement('p');
  help.className = 'order-help-link';
  help.innerHTML = 'Can\'t find your order? <a href="https://wa.me/923010746622?text=' +
    encodeURIComponent('Assalam-o-alaikum GiftWALA, I need help with my order.') +
    '" target="_blank" rel="noopener">Chat with us on WhatsApp</a> and we will check the latest status for you.';
  card.after(help);
});
