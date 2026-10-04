const KEY = 'chadarat_theme';

function apply(mode) {
  if (mode) document.documentElement.setAttribute('data-theme', mode);
  else document.documentElement.removeAttribute('data-theme');
}

const saved = localStorage.getItem(KEY);
apply(saved);

export function initThemeToggle(buttonEl) {
  updateIcon(buttonEl);
  buttonEl.addEventListener('click', () => {
    const current = localStorage.getItem(KEY) ||
      (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    const next = current === 'dark' ? 'light' : 'dark';
    localStorage.setItem(KEY, next);
    apply(next);
    updateIcon(buttonEl);
  });
}

function updateIcon(buttonEl) {
  const mode = localStorage.getItem(KEY) ||
    (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  const label = buttonEl.querySelector('.rail-label');
  const text = mode === 'dark' ? 'โหมดสว่าง' : 'โหมดมืด';
  if (label) label.textContent = text;
  else buttonEl.textContent = text;
}
