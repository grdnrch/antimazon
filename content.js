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

  // Extract visible text from a small badge element while ignoring hidden anti-adblock decoy spans
  function getCleanBadgeText(el) {
    if (!el) return '';
    if (el.children.length === 0) {
      return (el.textContent || '').trim();
    }
    let result = '';
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const parent = node.parentElement;
      if (!parent) continue;
      const style = window.getComputedStyle(parent);
      if (
        style.display === 'none' ||
        style.visibility === 'hidden' ||
        style.opacity === '0' ||
        style.fontSize === '0px' ||
        style.width === '0px' ||
        style.height === '0px' ||
        (style.position === 'absolute' && parseFloat(style.left) < -100)
      ) {
        continue;
      }
      result += node.nodeValue;
    }
    return result.trim();
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
    // A single Marketplace grid card is a single column tile (never wider than ~520px)
    const width = node.offsetWidth;
    if (width > 520) {
      return true;
    }
    return false;
  }

  function isCardSizedTile(node) {
    if (!node || node.nodeType !== Node.ELEMENT_NODE) return false;
    const w = node.offsetWidth;
    const h = node.offsetHeight;
    return w >= 120 && w <= 520 && h >= 140;
  }

  function hasCardMedia(node) {
    if (!node || node.nodeType !== Node.ELEMENT_NODE) return false;
    return Boolean(node.querySelector('img, video'));
  }

  function countOrganicMarketplaceIds(node) {
    const organicLinks = node.querySelectorAll('a[href*="/marketplace/item/"]');
    const uniqueItemIds = new Set();
    organicLinks.forEach((a) => {
      const match = a.getAttribute('href')?.match(/\/marketplace\/item\/(\d+)/);
      if (match) uniqueItemIds.add(match[1]);
    });
    return uniqueItemIds.size;
  }

  // Walk up from any inner element (badge, video, link) to the outer grid cell of that single card
  function findMarketplaceGridTile(startEl) {
    let curr = startEl;
    let depth = 0;
    const MAX_DEPTH = 25;

    while (curr && curr !== document.body && curr !== document.documentElement && depth < MAX_DEPTH) {
      const parent = curr.parentElement;
      if (!parent) break;

      if (isForbiddenContainer(curr)) {
        return null;
      }

      if (hasCardMedia(curr) && isCardSizedTile(curr)) {
        const parentWidth = parent.offsetWidth;
        // When `parent` is the multi-column row/grid container, it is significantly wider than a single tile
        const isMultiColumnParent = parentWidth > curr.offsetWidth * 1.7;

        let siblingHasMedia = false;
        for (const child of parent.children) {
          if (child !== curr && hasCardMedia(child)) {
            siblingHasMedia = true;
            break;
          }
        }

        if (isMultiColumnParent && siblingHasMedia) {
          if (countOrganicMarketplaceIds(curr) <= 1) {
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

  function tileHasAdBadge(tile) {
    // Fast check on innerText lines
    const lines = (tile.innerText || '').split('\n');
    for (const line of lines) {
      if (isAdLabelText(line)) return true;
    }

    // Check aria-labels and obfuscated small text containers inside the tile
    const els = tile.querySelectorAll('span, div[aria-label], a[aria-label]');
    for (const el of els) {
      const aria = el.getAttribute('aria-label') || '';
      if (isAdLabelText(aria)) return true;

      if (el.children.length <= 15 && (el.textContent || '').length <= 45) {
        if (isAdLabelText(getCleanBadgeText(el))) {
          return true;
        }
      }
    }
    return false;
  }

  function hideFacebookMarketplaceAds() {
    const pathname = window.location.pathname;
    // Only run on Marketplace browse/search pages, never inside an individual item detail view
    if (!pathname.startsWith('/marketplace') || pathname.startsWith('/marketplace/item')) {
      return;
    }

    // 1. Locate all active Marketplace grid containers via organic `/marketplace/item/` links
    // and inspect every sibling tile in those grids.
    const gridContainers = new Set();
    document.querySelectorAll('a[href*="/marketplace/item/"]').forEach((link) => {
      if (link.closest('[role="dialog"]')) return;
      const tile = findMarketplaceGridTile(link);
      if (tile && tile.parentElement) {
        gridContainers.add(tile.parentElement);
      }
    });

    gridContainers.forEach((grid) => {
      for (const tile of grid.children) {
        if (tile.getAttribute('data-antimazon-hidden') === 'true') continue;
        if (isForbiddenContainer(tile) || !hasCardMedia(tile) || !isCardSizedTile(tile)) continue;

        const hasOrganicItemLink = Boolean(tile.querySelector('a[href*="/marketplace/item/"]'));
        const hasVideo = Boolean(tile.querySelector('video'));
        const hasText = (tile.innerText || '').trim().length > 0;

        // Every real Marketplace item tile links to `/marketplace/item/<id>`.
        // Injected third-party ad tiles (e.g. video ads or brand ads) sit in the same grid
        // without a `/marketplace/item/` link, or contain a `<video>` player, or carry an "Ad" label.
        if ((!hasOrganicItemLink && hasText) || hasVideo || tileHasAdBadge(tile)) {
          tile.setAttribute('data-antimazon-hidden', 'true');
        }
      }
    });

    // 2. Fallback: directly find any `<video>` or "Ad"/"Sponsored" badge in Marketplace grids
    document.querySelectorAll('video').forEach((video) => {
      if (video.closest('[data-antimazon-hidden="true"], [role="dialog"]')) return;
      const tile = findMarketplaceGridTile(video);
      if (tile) {
        tile.setAttribute('data-antimazon-hidden', 'true');
      }
    });

    const candidates = document.querySelectorAll(
      'span, div[aria-label="Ad"], div[aria-label="Sponsored"], a[aria-label="Ad"], a[aria-label="Sponsored"]'
    );

    for (const el of candidates) {
      if (el.closest('[data-antimazon-hidden="true"], [role="dialog"]')) continue;

      const aria = el.getAttribute('aria-label') || '';
      let isAd = isAdLabelText(aria);

      if (!isAd) {
        const raw = el.textContent || '';
        if (raw.length > 0 && raw.length <= 45 && el.children.length <= 15) {
          if (el.children.length === 0 && isAdLabelText(raw)) {
            isAd = true;
          } else if (isAdLabelText(getCleanBadgeText(el))) {
            isAd = true;
          }
        }
      }

      if (isAd) {
        const tile = findMarketplaceGridTile(el);
        if (tile) {
          tile.setAttribute('data-antimazon-hidden', 'true');
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
