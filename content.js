(() => {
  const REVIEW_SORT_VALUE = 'review-rank';

  // 1. If we land on a search page (/s) without an explicit sort parameter (`s=`),
  // redirect immediately to sort by Avg. Customer Review.
  function enforceDefaultSortInUrl() {
    const url = new URL(window.location.href);
    const isSearchPage = url.pathname === '/s' || url.pathname.startsWith('/s/');
    const hasQuery = url.searchParams.has('k') || url.searchParams.has('field-keywords');

    if (isSearchPage && hasQuery && !url.searchParams.has('s')) {
      url.searchParams.set('s', REVIEW_SORT_VALUE);
      window.location.replace(url.toString());
      return true;
    }
    return false;
  }

  if (enforceDefaultSortInUrl()) {
    return;
  }

  // 2. Inject hidden sort input into Amazon's search bar so new searches
  // request Avg. Customer Review on the first load (avoiding a redirect).
  function injectSearchFormSort() {
    const form = document.getElementById('nav-search-bar-form');
    if (!form) return;

    let sortInput = form.querySelector('input[name="s"]');
    if (!sortInput) {
      sortInput = document.createElement('input');
      sortInput.type = 'hidden';
      sortInput.name = 's';
      form.appendChild(sortInput);
    }
    sortInput.value = REVIEW_SORT_VALUE;
  }

  // 3. Remove sponsored products, brand banners, and ad carousels.
  function removeSponsoredResults() {
    // Known sponsored selectors
    const directSelectors = [
      '.AdHolder',
      '[data-component-type="sp-sponsored-result"]',
      '[data-component-type="s-ads-metrics"]',
      '.puis-sponsored-label-text',
      '.s-sponsored-label-info-icon',
      '[data-cel-widget*="AdHolder"]',
      '[cel_widget_id*="multi-brand-creative"]',
      'div[id^="sp_detail"]',
      'div[id^="ape_"]'
    ];

    document.querySelectorAll(directSelectors.join(',')).forEach((el) => {
      const card =
        el.closest('[data-component-type="s-search-result"]') ||
        el.closest('.s-result-item') ||
        el.closest('.s-widget-container') ||
        el;
      card.remove();
    });

    // Catch fallback text-based "Sponsored" labels or excluded keywords inside search result cards
    const excludedKeywordRegex = /christian/i;

    document.querySelectorAll('[data-component-type="s-search-result"], .s-result-item').forEach((card) => {
      if (excludedKeywordRegex.test(card.textContent || '')) {
        card.remove();
        return;
      }

      const spans = card.querySelectorAll('span, a[aria-label*="Sponsored"]');
      for (const el of spans) {
        const text = el.textContent ? el.textContent.trim() : '';
        const aria = el.getAttribute('aria-label') || '';
        if (text === 'Sponsored' || aria.includes('Sponsored')) {
          card.remove();
          break;
        }
      }
    });
  }

  function init() {
    injectSearchFormSort();
    removeSponsoredResults();

    // Watch for dynamic page updates (infinite scroll, AJAX filter/page changes)
    const observer = new MutationObserver(() => {
      injectSearchFormSort();
      removeSponsoredResults();
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
