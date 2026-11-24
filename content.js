(() => {
  const hostname = window.location.hostname;
  const isAmazon = hostname.includes('amazon.');
  const isFacebook = hostname.includes('facebook.com');
  const isReddit = hostname.includes('reddit.com');

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

  function isForbiddenContainer(node) {
    if (!node || node.nodeType !== Node.ELEMENT_NODE) return true;
    const role = node.getAttribute('role');
    if (role === 'main' || role === 'dialog' || role === 'navigation' || role === 'banner') {
      return true;
    }
    if (node.querySelector('[role="main"], [role="dialog"]')) {
      return true;
    }
    // A single Marketplace grid card is a single column tile (never wider than ~500px)
    const width = node.offsetWidth;
    if (width > 520) {
      return true;
    }
    return false;
  }

  function hasListingCardContent(node) {
    if (!node || node.nodeType !== Node.ELEMENT_NODE) return false;
    return Boolean(node.querySelector(FB_LISTING_LINK_SELECTOR) && node.querySelector('img'));
  }

  function findMarketplaceCardToHide(badgeEl) {
    let curr = badgeEl;
    let depth = 0;
    const MAX_DEPTH = 10;

    // Walk up at most MAX_DEPTH levels to find the single grid cell card
    while (curr && curr !== document.body && curr !== document.documentElement && depth < MAX_DEPTH) {
      const parent = curr.parentElement;
      if (!parent) break;

      if (isForbiddenContainer(curr)) {
        return null;
      }

      if (hasListingCardContent(curr)) {
        // Check if any sibling of `curr` in the same grid row/container also contains a card
        let siblingHasCard = false;
        for (const child of parent.children) {
          if (child !== curr && hasListingCardContent(child)) {
            siblingHasCard = true;
            break;
          }
        }

        if (siblingHasCard) {
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
      depth++;
    }

    return null;
  }

  function hideFacebookMarketplaceAds() {
    const pathname = window.location.pathname;
    // Only run on Marketplace browse/search pages, never inside an individual item detail view
    if (!pathname.startsWith('/marketplace') || pathname.startsWith('/marketplace/item')) {
      return;
    }

    // Hide Marketplace grid cards explicitly marked with an "Ad" or "Sponsored" badge
    const candidates = document.querySelectorAll(
      'span, div[aria-label="Ad"], div[aria-label="Sponsored"], a[aria-label="Ad"], a[aria-label="Sponsored"]'
    );

    for (const el of candidates) {
      if (el.closest('[data-antimazon-hidden="true"]')) continue;
      if (el.closest('[role="dialog"]')) continue;

      const aria = el.getAttribute('aria-label') || '';
      let isAd = isAdLabelText(aria);

      if (!isAd) {
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
  // REDDIT LOGIC
  // ============================================================================

  function hideRedditAds() {
    const adSelectors = [
      'shreddit-ad-post',
      'shreddit-comments-page-ad',
      'shreddit-sidebar-ad',
      'shreddit-dynamic-ad-link',
      'shreddit-post[promoted]',
      '.promotedlink',
      '.promoted',
      '#siteTable_promoted',
      'div[data-before-content="advertisement"]',
      '[data-testid="ad-post"]'
    ];

    document.querySelectorAll(adSelectors.join(',')).forEach((el) => {
      const container = el.closest('article') || el;
      container.setAttribute('data-antimazon-hidden', 'true');
    });

    // Catch fallback posts/cards containing a "Promoted" badge
    document.querySelectorAll('article, shreddit-post, [data-testid="post-container"]').forEach((post) => {
      if (post.getAttribute('data-antimazon-hidden') === 'true') return;

      const spans = post.querySelectorAll('span, div');
      for (const el of spans) {
        if (el.children.length === 0) {
          const text = (el.textContent || '').trim();
          if (text === 'Promoted' || text === 'Sponsored') {
            const container = post.closest('article') || post;
            container.setAttribute('data-antimazon-hidden', 'true');
            break;
          }
        }
      }
    });
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
    } else if (isReddit) {
      hideRedditAds();
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
