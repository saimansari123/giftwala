/* GiftWALA — shared REAL reviews helpers (Round 21, 2026-11-27).
   Used by reviews.html (via reviews-ui.js), the homepage (script.js) and
   product.html. Everything here renders ONLY real reviews from
   GET /api/reviews — nothing is hardcoded. The public endpoint returns
   APPROVED reviews only; a review is "verified" once an admin approves it
   in the admin panel (they check it against a real order first). A review
   with no `status` field (legacy rows, written before moderation existed)
   is treated as approved, because those rows were public before.
   Pure functions (no DOM access except renderReviewsInto, which only sets
   innerHTML/hidden on elements it is handed) so they can be unit-tested
   in Node. UMD export: window.GWReviews in the browser, module.exports
   under Node. */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.GWReviews = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  var STAR_PATH = 'M12 2.5l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 17.4l-5.8 3 1.1-6.5L2.6 9.3l6.5-.9z';

  function esc(v) {
    return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function starSvg(size) {
    return '<svg viewBox="0 0 24 24" width="' + size + '" height="' + size + '" fill="currentColor" aria-hidden="true"><path d="' + STAR_PATH + '"/></svg>';
  }

  function starsRow(n, size) {
    n = Math.max(0, Math.min(5, Math.round(Number(n) || 0)));
    var out = '';
    for (var i = 0; i < n; i++) out += starSvg(size);
    return '<span class="rv-stars" style="display:inline-flex;gap:2px;vertical-align:-2px;color:#c28a22">' + out + '</span>';
  }

  // Verified = approved by an admin (or a legacy row with no status).
  // 'pending' and 'rejected' are NEVER verified and never count.
  function isVerified(x) {
    if (!x) return false;
    if (x.status === undefined || x.status === null || x.status === '') return true;
    return x.status === 'approved';
  }

  function verifiedOnly(list) {
    return (Array.isArray(list) ? list : []).filter(isVerified);
  }

  // Summary over VERIFIED reviews only. avg is null when there are none.
  function computeSummary(list) {
    var xs = verifiedOnly(list);
    var dist = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
    var total = 0;
    xs.forEach(function (x) {
      var r = Math.max(1, Math.min(5, Math.round(Number(x.rating) || 0)));
      dist[r] += 1;
      total += Number(x.rating) || 0;
    });
    return {
      count: xs.length,
      avg: xs.length ? total / xs.length : null,
      dist: dist,
      fivePct: xs.length ? Math.round(dist[5] / xs.length * 100) : 0
    };
  }

  function summaryHtml(s) {
    if (!s || !s.count) return '';
    var bars = [5, 4, 3, 2, 1].map(function (star) {
      var pct = Math.round(s.dist[star] / s.count * 100);
      return '<div class="rv-dist-row"><span>' + star + '★</span>' +
        '<span class="rv-dist-bar"><i style="width:' + pct + '%"></i></span>' +
        '<span>' + s.dist[star] + '</span></div>';
    }).join('');
    return '<div class="rv-summary"><strong>' + s.avg.toFixed(1) + '</strong>' +
      '<span class="rv-summary-stars">' + starsRow(Math.round(s.avg), 18) +
      '<small>Based on ' + s.count + ' verified customer review' + (s.count === 1 ? '' : 's') + '</small></span>' +
      '<div class="rv-dist">' + bars + '</div></div>';
  }

  function fmtDate(ts) {
    var d = new Date(Number(ts));
    if (isNaN(d.getTime())) return '';
    try { return d.toLocaleDateString('en-PK', { day: 'numeric', month: 'short', year: 'numeric' }); }
    catch (e) { return d.toLocaleDateString(); }
  }

  // One review card. Approved -> green "Verified order" badge.
  // Pending -> amber "Awaiting verification" badge (never counted).
  function reviewCardHtml(x) {
    var verified = isVerified(x);
    var meta = [x.name, x.city, x.productName].filter(function (v) { return v; }).map(esc).join(' &middot; ');
    var date = fmtDate(x.createdAt);
    return '<article class="rv-card">' + starsRow(x.rating, 15) +
      '<h3>&ldquo;' + esc(x.comment) + '&rdquo;</h3>' +
      '<p class="rv-meta">' + (meta || 'GiftWALA customer') + (date ? ' &middot; ' + esc(date) : '') + '</p>' +
      (verified
        ? '<span class="rv-badge rv-badge--verified">Verified order</span>'
        : '<span class="rv-badge rv-badge--pending">Awaiting verification</span>') +
      '</article>';
  }

  // Render into plain elements (real DOM or a stub with innerHTML/hidden).
  // opts: { grid, empty, summary, verified, pending, limit }
  // - summary: average/distribution over verified only (hidden when none).
  // - empty: honest empty state, shown only when there are no verified reviews.
  // - pending: just-submitted reviews, shown with the awaiting badge and
  //   NEVER counted in the summary.
  function renderReviewsInto(opts) {
    var verified = verifiedOnly(opts.verified || []);
    var pending = (opts.pending || []).filter(function (x) { return !isVerified(x); });
    var list = pending.concat(verified);
    if (opts.limit) list = list.slice(0, opts.limit);
    if (opts.grid) opts.grid.innerHTML = list.map(reviewCardHtml).join('');
    if (opts.empty) opts.empty.hidden = verified.length > 0;
    if (opts.summary) {
      var s = computeSummary(verified);
      opts.summary.innerHTML = summaryHtml(s);
      opts.summary.hidden = !s.count;
    }
    return { shown: list.length, verifiedCount: verified.length, pendingCount: pending.length };
  }

  function fetchApprovedReviews() {
    return fetch('/api/reviews')
      .then(function (r) { return r.ok ? r.json() : []; })
      .then(function (xs) { return Array.isArray(xs) ? xs : []; })
      .catch(function () { return []; });
  }

  // Submit a review. Resolves with the saved review (status 'pending').
  // Throws an Error with the server's message on failure.
  function submitReview(payload) {
    var body = {
      name: String(payload.name || '').trim(),
      city: String(payload.city || '').trim(),
      productId: String(payload.productId || '').trim(),
      productName: String(payload.productName || '').trim(),
      rating: Number(payload.rating) || 0,
      comment: String(payload.comment || '').trim()
    };
    if (!body.name) return Promise.reject(new Error('Please enter your name.'));
    if (!body.comment) return Promise.reject(new Error('Please write your review.'));
    if (!(body.rating >= 1 && body.rating <= 5)) return Promise.reject(new Error('Please choose a star rating.'));
    return fetch('/api/reviews', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (r) {
      if (!r.ok) {
        return r.json().catch(function () { return {}; }).then(function (j) {
          throw new Error(j.message || 'Could not save your review. Please try again.');
        });
      }
      return r.json();
    });
  }

  return {
    esc: esc,
    starSvg: starSvg,
    starsRow: starsRow,
    isVerified: isVerified,
    verifiedOnly: verifiedOnly,
    computeSummary: computeSummary,
    summaryHtml: summaryHtml,
    reviewCardHtml: reviewCardHtml,
    renderReviewsInto: renderReviewsInto,
    fetchApprovedReviews: fetchApprovedReviews,
    submitReview: submitReview
  };
});
