// Полные цветовые темы: фон, поверхности, текст, границы и оба акцента.
// Тема хранится локально и входит в стандартную синхронизацию настроек аккаунта.
export const THEME_STORAGE_KEY = 'gulrating:theme';

export const THEMES = [
  {
    id: 'classic',
    name: 'Классическая',
    description: 'Тёмно-синяя · индиго',
    themeColor: '#0f172a',
    preview: { bg: '15 23 42', card: '30 41 59', primary: '99 102 241', secondary: '236 72 153' },
  },
  {
    id: 'ocean',
    name: 'Океан',
    description: 'Глубокий синий · бирюза',
    themeColor: '#07131d',
    preview: { bg: '7 19 29', card: '16 37 52', primary: '14 116 144', secondary: '3 105 161' },
  },
  {
    id: 'forest',
    name: 'Лес',
    description: 'Хвойный · зелёный',
    themeColor: '#0c1714',
    preview: { bg: '12 23 20', card: '24 42 35', primary: '21 128 61', secondary: '161 98 7' },
  },
  {
    id: 'light',
    name: 'Светлая',
    description: 'Бумага · тёмный коралл',
    themeColor: '#f8f6f2',
    preview: { bg: '248 246 242', card: '255 253 249', primary: '177 58 43', secondary: '153 82 13' },
  },
];

const themeIds = new Set(THEMES.map(theme => theme.id));

export function getThemeId() {
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    if (themeIds.has(saved)) return saved;
    // Сохраняем прежний выбор акцента при первом переходе на систему тем.
    const legacyAccent = localStorage.getItem('gulrating:accent');
    if (legacyAccent === '16 185 129' || legacyAccent === '249 115 22') return 'forest';
    if (legacyAccent === '59 130 246') return 'ocean';
    return 'classic';
  } catch (error) {
    return 'classic';
  }
}

export function applyTheme(themeId = getThemeId()) {
  const selected = themeIds.has(themeId) ? themeId : 'classic';
  if (typeof document !== 'undefined') {
    document.documentElement.dataset.theme = selected;
    const theme = THEMES.find(item => item.id === selected);
    const themeMeta = document.querySelector('meta[name="theme-color"]');
    if (themeMeta && theme) themeMeta.content = theme.themeColor;
    const statusBar = document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]');
    if (statusBar) statusBar.content = selected === 'light' ? 'default' : 'black-translucent';
  }
  return selected;
}

export function setTheme(themeId) {
  const selected = themeIds.has(themeId) ? themeId : 'classic';
  try {
    localStorage.setItem(THEME_STORAGE_KEY, selected);
  } catch (error) { /* private mode: theme still applies for this page */ }
  applyTheme(selected);
  return selected;
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', event => {
    if (event.key === THEME_STORAGE_KEY) applyTheme(getThemeId());
  });
}
