export const DOT_RATING_DIGITS = {
  '0': ['111', '101', '101', '101', '111'],
  '1': ['010', '110', '010', '010', '111'],
  '2': ['111', '001', '111', '100', '111'],
  '3': ['111', '001', '111', '001', '111'],
  '4': ['101', '101', '111', '001', '001'],
  '5': ['111', '100', '111', '001', '111'],
  '6': ['111', '100', '111', '101', '111'],
  '7': ['111', '001', '010', '010', '010'],
  '8': ['111', '101', '111', '101', '111'],
  '9': ['111', '101', '111', '001', '111'],
};

const DOT_TEXT_GLYPHS = {
  ...DOT_RATING_DIGITS,
  A: ['010', '101', '111', '101', '101'],
  B: ['110', '101', '110', '101', '110'],
  C: ['011', '100', '100', '100', '011'],
  D: ['110', '101', '101', '101', '110'],
  E: ['111', '100', '110', '100', '111'],
  F: ['111', '100', '110', '100', '100'],
  G: ['011', '100', '101', '101', '011'],
  H: ['101', '101', '111', '101', '101'],
  I: ['111', '010', '010', '010', '111'],
  J: ['001', '001', '001', '101', '010'],
  K: ['101', '101', '110', '101', '101'],
  L: ['100', '100', '100', '100', '111'],
  M: ['101', '111', '111', '101', '101'],
  N: ['101', '111', '111', '111', '101'],
  O: ['010', '101', '101', '101', '010'],
  P: ['110', '101', '110', '100', '100'],
  Q: ['010', '101', '101', '111', '011'],
  R: ['110', '101', '110', '101', '101'],
  S: ['011', '100', '010', '001', '110'],
  T: ['111', '010', '010', '010', '010'],
  U: ['101', '101', '101', '101', '111'],
  V: ['101', '101', '101', '101', '010'],
  W: ['101', '101', '111', '111', '101'],
  X: ['101', '101', '010', '101', '101'],
  Y: ['101', '101', '010', '010', '010'],
  Z: ['111', '001', '010', '100', '111'],
  А: ['010', '101', '111', '101', '101'],
  Б: ['111', '100', '110', '101', '110'],
  В: ['110', '101', '110', '101', '110'],
  Г: ['111', '100', '100', '100', '100'],
  Д: ['011', '101', '101', '101', '111'],
  Е: ['111', '100', '110', '100', '111'],
  Ё: ['101', '000', '111', '100', '111'],
  Ж: ['101', '111', '010', '111', '101'],
  З: ['110', '001', '010', '001', '110'],
  И: ['101', '111', '111', '111', '101'],
  Й: ['010', '101', '111', '111', '101'],
  К: ['101', '101', '110', '101', '101'],
  Л: ['011', '101', '101', '101', '101'],
  М: ['101', '111', '111', '101', '101'],
  Н: ['101', '101', '111', '101', '101'],
  О: ['010', '101', '101', '101', '010'],
  П: ['111', '101', '101', '101', '101'],
  Р: ['110', '101', '110', '100', '100'],
  С: ['011', '100', '100', '100', '011'],
  Т: ['111', '010', '010', '010', '010'],
  У: ['101', '101', '010', '010', '100'],
  Ф: ['010', '111', '101', '111', '010'],
  Х: ['101', '101', '010', '101', '101'],
  Ц: ['101', '101', '101', '111', '001'],
  Ч: ['101', '101', '111', '001', '001'],
  Ш: ['101', '101', '101', '111', '111'],
  Щ: ['101', '101', '101', '111', '011'],
  Ъ: ['110', '100', '110', '101', '110'],
  Ы: ['101', '101', '110', '101', '101'],
  Ь: ['100', '100', '110', '101', '110'],
  Э: ['111', '001', '111', '001', '111'],
  Ю: ['101', '111', '101', '111', '101'],
  Я: ['011', '101', '011', '001', '101'],
  '!': ['010', '010', '010', '000', '010'],
  '?': ['110', '001', '010', '000', '010'],
  ',': ['000', '000', '000', '010', '100'],
  '.': ['000', '000', '000', '000', '010'],
  '-': ['000', '000', '111', '000', '000'],
  '_': ['000', '000', '000', '000', '111'],
  ':': ['000', '010', '000', '010', '000'],
  ';': ['000', '010', '000', '010', '100'],
  '+': ['000', '010', '111', '010', '000'],
  '/': ['001', '001', '010', '100', '100'],
  '(': ['001', '010', '010', '010', '001'],
  ')': ['100', '010', '010', '010', '100'],
  '&': ['010', '101', '010', '101', '011'],
  '@': ['111', '101', '111', '100', '111'],
};

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character]);
}

export function renderDotMatrixText(value, { unsupported = 'question' } = {}) {
  return [...String(value ?? '').toLocaleUpperCase('ru-RU')].map(character => {
    if (/\s/u.test(character)) return '<span class="dot-text-space" aria-hidden="true"></span><wbr>';
    const rows = DOT_TEXT_GLYPHS[character];
    if (!rows) {
      if (unsupported === 'plain') {
        return `<span class="dot-text-symbol" data-symbol="${escapeHtml(character)}" aria-hidden="true"></span>`;
      }
      return '<span class="rating-dot-digit dot-text-glyph" aria-hidden="true">'
        + DOT_TEXT_GLYPHS['?'].join('').split('').map(dot =>
          `<i class="rating-dot-cell${dot === '1' ? ' is-on' : ''}"></i>`
        ).join('')
        + '</span>';
    }
    const cells = rows.join('').split('').map(dot =>
      `<i class="rating-dot-cell${dot === '1' ? ' is-on' : ''}"></i>`
    ).join('');
    return `<span class="rating-dot-digit dot-text-glyph" aria-hidden="true">${cells}</span>`;
  }).join('');
}

const HEADING_SELECTOR = 'h1, h2, h3, h4, h5, h6, [role="heading"]';

function enhanceHeading(heading) {
  // Card titles are dense, frequently truncated metadata—not decorative section
  // headings. Keep them in the normal font so the Nothing theme remains readable.
  if (heading.closest('.title-card, .catalog-item, .rec-card, .history-title, .search-result-item')) return;
  const showText = document.defaultView?.NodeFilter?.SHOW_TEXT ?? 4;
  const walker = document.createTreeWalker(heading, showText);
  const textNodes = [];
  let node;
  while ((node = walker.nextNode())) {
    if (!node.nodeValue || node.parentElement?.closest('.dot-matrix-plain, .dot-matrix-rendered, .dot-matrix-ignore, [aria-hidden="true"], svg, script, style')) continue;
    textNodes.push(node);
  }

  for (const textNode of textNodes) {
    const source = document.createElement('span');
    source.className = 'dot-matrix-plain';
    source.textContent = textNode.nodeValue;

    const matrix = document.createElement('span');
    matrix.className = 'dot-matrix-rendered';
    matrix.setAttribute('aria-hidden', 'true');
    matrix.innerHTML = renderDotMatrixText(textNode.nodeValue, { unsupported: 'plain' });

    textNode.replaceWith(source, matrix);
  }
}

function enhanceSubtree(node) {
  if (node.nodeType === Node.TEXT_NODE) {
    const heading = node.parentElement?.closest(HEADING_SELECTOR);
    if (heading) enhanceHeading(heading);
    return;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return;
  if (node.matches(HEADING_SELECTOR)) enhanceHeading(node);
  node.querySelectorAll(HEADING_SELECTOR).forEach(enhanceHeading);
  const parentHeading = node.parentElement?.closest(HEADING_SELECTOR);
  if (parentHeading) enhanceHeading(parentHeading);
}

export function installDotMatrixHeadings(root = document.body) {
  if (!root || typeof MutationObserver === 'undefined') return () => {};
  root.querySelectorAll(HEADING_SELECTOR).forEach(enhanceHeading);

  const observer = new MutationObserver(records => {
    for (const record of records) {
      if (record.type === 'characterData') {
        const source = record.target.parentElement?.closest('.dot-matrix-plain');
        const matrix = source?.nextElementSibling;
        if (matrix?.classList.contains('dot-matrix-rendered')) {
          matrix.innerHTML = renderDotMatrixText(record.target.nodeValue, { unsupported: 'plain' });
        } else {
          enhanceSubtree(record.target);
        }
        continue;
      }
      if (record.target.nodeType === Node.ELEMENT_NODE && record.target.matches('.dot-matrix-plain')) {
        const matrix = record.target.nextElementSibling;
        if (matrix?.classList.contains('dot-matrix-rendered')) {
          matrix.innerHTML = renderDotMatrixText(record.target.textContent, { unsupported: 'plain' });
          continue;
        }
      }
      for (const addedNode of record.addedNodes) enhanceSubtree(addedNode);
      if (record.target.nodeType === Node.ELEMENT_NODE && record.target.matches(HEADING_SELECTOR)) {
        enhanceHeading(record.target);
      }
    }
  });
  observer.observe(root, { childList: true, characterData: true, subtree: true });
  return () => observer.disconnect();
}
