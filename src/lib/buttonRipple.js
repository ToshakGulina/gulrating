const activeRipples = new WeakMap();

function prefersReducedMotion() {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

export function getRippleGeometry(rect, clientX, clientY) {
  const x = Math.max(0, Math.min(rect.width, clientX - rect.left));
  const y = Math.max(0, Math.min(rect.height, clientY - rect.top));
  const farthestX = Math.max(x, rect.width - x);
  const farthestY = Math.max(y, rect.height - y);
  return { x, y, diameter: Math.ceil(Math.hypot(farthestX, farthestY) * 2) };
}

function createRipple(button, clientX, clientY) {
  if (prefersReducedMotion()) return;

  const rect = button.getBoundingClientRect();
  if (!rect.width || !rect.height) return;

  const { x, y, diameter } = getRippleGeometry(rect, clientX, clientY);

  let state = activeRipples.get(button);
  if (!state) {
    state = {
      count: 0,
      inlinePosition: button.style.position,
    };
    if (getComputedStyle(button).position === 'static') button.style.position = 'relative';
    button.classList.add('button-ripple-host');
    activeRipples.set(button, state);
  }
  state.count += 1;

  const mask = document.createElement('span');
  mask.className = 'button-ripple-mask';
  mask.setAttribute('aria-hidden', 'true');

  const wave = document.createElement('span');
  wave.className = 'button-ripple';
  wave.style.width = `${diameter}px`;
  wave.style.height = `${diameter}px`;
  wave.style.left = `${x - diameter / 2}px`;
  wave.style.top = `${y - diameter / 2}px`;
  mask.appendChild(wave);
  button.appendChild(mask);

  let finished = false;
  const cleanup = () => {
    if (finished) return;
    finished = true;
    mask.remove();
    state.count -= 1;
    if (state.count === 0) {
      button.classList.remove('button-ripple-host');
      button.style.position = state.inlinePosition;
      activeRipples.delete(button);
    }
  };

  wave.addEventListener('animationend', cleanup, { once: true });
  window.setTimeout(cleanup, 700);
}

function getButton(target) {
  return target instanceof Element ? target.closest('button:not(:disabled)') : null;
}

export function installButtonRipple() {
  if (typeof document === 'undefined' || typeof window === 'undefined') return;

  document.addEventListener('pointerdown', event => {
    if (!event.isPrimary || (event.pointerType === 'mouse' && event.button !== 0)) return;
    const button = getButton(event.target);
    if (button) createRipple(button, event.clientX, event.clientY);
  }, true);

  // Клавиатурное активирование не создаёт pointerdown; для него начинаем волну
  // из центра кнопки. Нативные click после касания сюда не попадают (detail > 0).
  document.addEventListener('click', event => {
    if (event.detail !== 0) return;
    const button = getButton(event.target);
    if (!button) return;
    const rect = button.getBoundingClientRect();
    createRipple(button, rect.left + rect.width / 2, rect.top + rect.height / 2);
  }, true);
}
