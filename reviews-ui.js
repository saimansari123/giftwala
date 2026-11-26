/* Reviews page — REAL reviews loop (Round 21, 2026-11-27).
   Renders ONLY real reviews from GET /api/reviews (approved only — the
   Worker filters by status). The summary (average + 5-to-1 distribution)
   is computed from VERIFIED reviews only, via reviews-shared.js.
   New reviews are POSTed to /api/reviews and come back as 'pending':
   they are shown once, with an "Awaiting verification" badge, and are
   NEVER counted in the average or the verified count until an admin
   approves them in the admin panel. Nothing here is hardcoded — when
   there are no verified reviews, the honest empty state is shown. */
document.addEventListener('DOMContentLoaded', () => {
  const m = document.querySelector('main.page-shell');
  if (!m) return;
  const R = window.GWReviews;
  if (!R) return; // reviews-shared.js failed to load; do not invent content.
  // ROUND 18 (2026-11-27): stars are inline SVG (gold, filled) — never text glyphs.
  const starSvg = s => R.starSvg(s);
  m.className = 'preview-ui';
  m.innerHTML =
    '<section class="preview-hero"><small>KIND WORDS, THOUGHTFULLY SHARED</small><h1>Loved by <em>gift-givers.</em></h1>' +
    '<p>Every thoughtful gift has a story. Explore feedback from GiftWALA customers and see what made their moments feel special.</p></section>' +
    '<section class="review-summary" id="reviewSummary" hidden></section>' +
    '<h2>Customer stories</h2>' +
    '<p class="reviews-empty" id="reviewsEmpty">No verified customer reviews yet — be the first to share yours below.</p>' +
    '<div class="review-grid" id="reviewGrid"></div>' +
    '<section class="review-box"><div class="intro"><p class="eyebrow">YOUR VOICE MATTERS</p><h2>Ordered from <span>GiftWALA?</span></h2>' +
    '<p>Share your experience and help someone choose a thoughtful gift with confidence.</p><div class="quote">&ldquo;</div></div>' +
    '<div class="form-wrap"><h3 class="form-title">Tell us about your experience</h3>' +
    '<form class="professional-review-form"><div class="rv-row"><input class="field" id="rvName" required placeholder="Your name">' +
    '<input class="field" id="rvCity" placeholder="Your city (optional)"></div>' +
    '<input class="field" id="rvProduct" placeholder="Which product did you order? (optional)" style="margin-top:10px">' +
    '<div class="rv-stars-row" aria-label="Rating" role="radiogroup"><span>' + starSvg(20) + '</span><span>' + starSvg(20) + '</span><span>' + starSvg(20) + '</span><span>' + starSvg(20) + '</span><span>' + starSvg(20) + '</span><span class="rv-rating-hint">Tap a star to rate</span></div>' +
    '<textarea id="rvComment" required placeholder="Write your review..."></textarea>' +
    '<div class="actions"><button type="button" class="btn whatsapp"><svg class="wag" viewBox="0 0 24 24" width="15" height="15" fill="currentColor" stroke="none" aria-hidden="true" style="vertical-align:-2px;margin-right:6px"><path fill="currentColor" stroke="none" d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z"/></svg> SHARE ON WHATSAPP</button>' +
    '<button type="submit" class="btn submit">SUBMIT REVIEW</button></div>' +
    '<p class="note">Your feedback helps us make every GiftWALA moment more special.</p></form></div></section>';

  const grid = document.getElementById('reviewGrid');
  const empty = document.getElementById('reviewsEmpty');
  const summary = document.getElementById('reviewSummary');

  R.fetchApprovedReviews().then(list => {
    R.renderReviewsInto({ grid, empty, summary, verified: list, pending: [] });
  });

  const box = m.querySelector('.review-box');
  const form = box.querySelector('form');
  const stars = [...box.querySelectorAll('.rv-stars-row > span')].filter(s => s.querySelector('svg'));
  const rating = { value: 0 };
  stars.forEach((s, i) => s.onclick = () => {
    rating.value = i + 1;
    stars.forEach((x, n) => x.classList.toggle('active', n <= i));
  });
  box.querySelector('.whatsapp').onclick = () =>
    window.open('https://wa.me/923010746622?text=' + encodeURIComponent('Hi GiftWALA! I would like to share a review.'), '_blank');
  form.onsubmit = e => {
    e.preventDefault();
    const note = form.querySelector('.note');
    const n = form.querySelector('#rvName').value.trim();
    const t = form.querySelector('#rvComment').value.trim();
    if (!rating.value) { note.textContent = 'Please choose a star rating first.'; stars[0].focus(); return; }
    if (!n || !t) { note.textContent = 'Please enter your name and write your review.'; return; }
    const btn = form.querySelector('.submit');
    btn.disabled = true;
    btn.textContent = 'SUBMITTING...';
    R.submitReview({
      name: n,
      city: form.querySelector('#rvCity').value,
      productName: form.querySelector('#rvProduct').value,
      rating: rating.value,
      comment: t
    })
      .then(saved => {
        // Pending: shown once with the awaiting badge, NEVER counted in
        // the summary (renderReviewsInto is not re-run, so the average
        // and verified count stay exactly as they were).
        const wrap = document.createElement('div');
        wrap.innerHTML = R.reviewCardHtml({ ...saved, status: 'pending' });
        grid.insertBefore(wrap.firstChild, grid.firstChild);
        form.reset();
        stars.forEach(x => x.classList.remove('active'));
        rating.value = 0;
        note.textContent = 'Thank you! Your review is awaiting verification and will appear once approved.';
        btn.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="vertical-align:-2px;margin-right:6px"><path d="M20 6L9 17l-5-5"/></svg> REVIEW SUBMITTED';
        setTimeout(() => { btn.disabled = false; btn.textContent = 'SUBMIT REVIEW'; }, 4000);
      })
      .catch(err => {
        btn.disabled = false;
        btn.textContent = 'SUBMIT REVIEW';
        note.textContent = err.message || 'Could not save your review. Please try again.';
      });
  };
});
