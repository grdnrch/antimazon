(() => {
  const hostname = window.location.hostname;
  const isAmazon = hostname.includes('amazon.');
  const isFacebook = hostname.includes('facebook.com');

  const REVIEW_SORT_VALUE = 'review-rank';

  // ============================================================================
  // AMAZON LOGIC
  // ============================================================================

  // 1. If we land on an Amazon search page (/s) without an explicit sort parameter (`s=`),
  // redirect immediately to sort by Avg. Customer Review.
  function enforceDefaultSortInUrl() {
    if (!isAmazon) return false;
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

  // 3. Remove Amazon sponsored products, brand banners, ad carousels, and excluded keywords.
  function removeAmazonSponsoredResults() {
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

  // ============================================================================
  // FACEBOOK MARKETPLACE LOGIC
  // ============================================================================

  const FB_LISTING_LINK_SELECTOR = 'a[href*="/marketplace/item/"], a[href*="l.facebook.com"], a[href*="/ads/"]';

  function isAdLabelText(rawText) {
    if (!rawText) return false;
    const text = rawText.replace(/[\u200B-\u200D\uFEFF]/g, '').trim();
    return (
      text === 'Ad' ||
      text === 'Sponsored' ||
      /^Ad\s*[·•\-]/i.test(text) ||
      /^Sponsored\s*[·•\-]/i.test(text)
    );
  }

  function hasListingCardContent(node) {
    if (!node || node.nodeType !== Node.ELEMENT_NODE) return false;
    return Boolean(node.querySelector(FB_LISTING_LINK_SELECTOR) && node.querySelector('img'));
  }

  function findMarketplaceCardToHide(badgeEl) {
    let curr = badgeEl;

    // Walk up until we find the grid cell whose parent holds multiple sibling cards
    while (curr && curr !== document.body && curr !== document.documentElement) {
      const parent = curr.parentElement;
      if (!parent) break;

      if (hasListingCardContent(curr)) {
        // Check if any sibling of `curr` also contains a Marketplace card
        let siblingHasCard = false;
        for (const child of parent.children) {
          if (child !== curr && hasListingCardContent(child)) {
            siblingHasCard = true;
            break;
          }
        }

        if (siblingHasCard) {
          // If `curr` is a whole "Sponsored" section containing only external ads, or a single grid card,
          // make sure we don't hide a container that holds multiple organic `/marketplace/item/` listings
          // unless `curr` itself is a single promoted `/marketplace/item/` card.
          const organicLinks = curr.querySelectorAll('a[href*="/marketplace/item/"]');
          const uniqueItemIds = new Set();
          organicLinks.forEach((a) => {
            const match = a.getAttribute('href')?.match(/\/marketplace\/item\/(\d+)/);
            if (match) uniqueItemIds.add(match[1]);
          });

          if (uniqueItemIds.size <= 1) {
            return curr;
          }
          return null;
        }
      }

      curr = parent;
    }

    return null;
  }

  function hideFacebookMarketplaceAds() {
    if (!window.location.pathname.startsWith('/marketplace')) return;

    // 1. Hide cards that link out to external Facebook ad redirects (l.facebook.com / /ads/)
    document.querySelectorAll('a[href*="l.facebook.com"], a[href*="/ads/"]').forEach((adLink) => {
      if (adLink.closest('[data-antimazon-hidden="true"]')) return;
      const card = findMarketplaceCardToHide(adLink);
      if (card) {
        card.setAttribute('data-antimazon-hidden', 'true');
      }
    });

    // 2. Hide Marketplace cards marked with an "Ad" or "Sponsored" badge
    const candidates = document.querySelectorAll(
      'span, div[aria-label="Ad"], div[aria-label="Sponsored"], a[aria-label="Ad"], a[aria-label="Sponsored"]'
    );

    for (const el of candidates) {
      if (el.closest('[data-antimazon-hidden="true"]')) continue;

      const aria = el.getAttribute('aria-label') || '';
      let isAd = isAdLabelText(aria);

      if (!isAd) {
        // Check leaf or small badge elements
        const raw = el.textContent || '';
        if (raw.length > 0 && raw.length <= 30) {
          if (el.children.length === 0 && isAdLabelText(raw)) {
            isAd = true;
          } else if (el.children.length > 0 && el.children.length <= 12 && isAdLabelText(el.innerText)) {
            isAd = true;
          }
        }
      }

      if (isAd) {
        const card = findMarketplaceCardToHide(el);
        if (card) {
          card.setAttribute('data-antimazon-hidden', 'true');
        }
      }
    }
  }

  // ============================================================================
  // INITIALIZATION & OBSERVER
  // ============================================================================

  let scheduled = false;
  function runCleanup() {
    scheduled = false;
    if (isAmazon) {
      injectSearchFormSort();
      removeAmazonSponsoredResults();
    } else if (isFacebook) {
      hideFacebookMarketplaceAds();
    }
  }

  function scheduleCleanup() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(runCleanup);
  }

  function init() {
    runCleanup();

    const observer = new MutationObserver(scheduleCleanup);
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
