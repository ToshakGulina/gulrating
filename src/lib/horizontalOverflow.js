const FIT_CLASS = 'overflow-fit-small';
const SMALL_OVERFLOW_PX = 24;

// Tiny overflow feels like a broken control: reduce gaps and let items contract
// slightly instead of making the user swipe through the last few pixels.
export function fitSmallHorizontalOverflow(element, tolerance = SMALL_OVERFLOW_PX) {
  if (!element?.classList) return 0;
  element.classList.remove(FIT_CLASS);
  const initialOverflow = Math.max(0, element.scrollWidth - element.clientWidth);
  if (initialOverflow > 0 && initialOverflow <= tolerance) {
    element.classList.add(FIT_CLASS);
  }
  return Math.max(0, element.scrollWidth - element.clientWidth);
}

export function installHorizontalOverflowFit(root = document.body) {
  if (!root || root.dataset.horizontalFitInstalled === 'true') return;
  root.dataset.horizontalFitInstalled = 'true';

  let frame = 0;
  let resizeObserver = null;
  const update = () => {
    if (frame) cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      frame = 0;
      root.querySelectorAll('.overflow-x-auto, .overflow-x-scroll').forEach(element => {
        fitSmallHorizontalOverflow(element);
        if (resizeObserver && element.dataset.horizontalFitObserved !== 'true') {
          element.dataset.horizontalFitObserved = 'true';
          resizeObserver.observe(element);
        }
      });
    });
  };

  if ('ResizeObserver' in window) resizeObserver = new ResizeObserver(update);
  const mutations = new MutationObserver(update);
  mutations.observe(root, { childList: true, subtree: true, characterData: true });
  window.addEventListener('resize', update, { passive: true });
  update();
}
