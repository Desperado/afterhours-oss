'use strict';
/* Colour theme. "night" is the stylesheet's default; every other theme is a token block in
   themes.css selected by <html data-theme>. Loaded in <head> without defer so the saved
   theme is applied before the first paint. */
window.AfterhoursTheme = (() => {
  // id → [name, browser chrome colour, colour scheme]. Names are proper names: not translated.
  const THEMES = {
    night: ['Night', '#080a0f', 'dark'],
    sampler: ['Sampler 60', '#c9c5b9', 'light'],
    redkeys: ['Red Keys', '#0c0c0d', 'dark'],
    red: ['Red Edition', '#d8382d', 'dark'],
    clips: ['Clip Launch', '#1b1c1e', 'dark'],
    blackbox: ['Black Box', '#080808', 'dark'],
    pads: ['Pad Grid', '#0b0b0f', 'dark'],
    deepblue: ['Deep Blue', '#08122b', 'dark'],
  };
  const KEY = 'afterhours-theme';
  let theme = 'night';
  try {
    const saved = localStorage.getItem(KEY);
    if (saved in THEMES) theme = saved;
  } catch {
    /* Private mode keeps the default. */
  }

  function apply() {
    const root = document.documentElement;
    if (theme === 'night') delete root.dataset.theme;
    else root.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEMES[theme][1]);
    document.querySelector('meta[name="color-scheme"]')?.setAttribute('content', THEMES[theme][2]);
    const picker = document.getElementById('theme-select');
    if (picker && picker.value !== theme) picker.value = theme;
  }
  function set(next) {
    if (!(next in THEMES) || next === theme) return;
    theme = next;
    try {
      localStorage.setItem(KEY, next);
    } catch {
      /* Private mode keeps the theme for this page only. */
    }
    apply();
    window.dispatchEvent(new CustomEvent('afterhours:theme', {detail: theme}));
  }

  apply();
  document.addEventListener('DOMContentLoaded', () => {
    const picker = document.getElementById('theme-select');
    if (picker) {
      picker.replaceChildren(...Object.entries(THEMES).map(([id, [name]]) => new Option(name, id)));
      picker.addEventListener('change', () => set(picker.value));
    }
    apply();
  });

  return {
    set,
    themes: Object.fromEntries(Object.entries(THEMES).map(([id, [name]]) => [id, name])),
    get theme() {
      return theme;
    },
  };
})();
