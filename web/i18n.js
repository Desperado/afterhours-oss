'use strict';
/* Interface language. English is the source language of the markup and scripts; other
   languages are dictionaries (see i18n-uk.js) applied to the DOM at runtime:

   - exact:    {"English text": "translation"} matches a whole, trimmed text node or one of
               the ATTRS below.
   - patterns: [["Loaded {0} · {1} BPM", "… {0} · {1} BPM"]] matches interpolated strings;
               captured values are looked up in `exact` before they are inserted.

   Modules keep writing English. Strings that never reach the DOM (confirm dialogs, names
   stored in a project) go through AfterhoursI18n.t('Template {0}', value) instead.
   Mark user content with data-i18n-skip so a recording called "Stop" stays "Stop". */
window.AfterhoursI18n = (() => {
  const LANGS = {en: 'English', uk: 'Українська'};
  const ATTRS = ['aria-label', 'title', 'placeholder', 'aria-valuetext', 'alt'];
  const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'CODE', 'TITLE']);
  const KEY = 'afterhours-lang';
  const dictionaries = window.AfterhoursDictionaries || {};

  function stored() {
    try {
      return localStorage.getItem(KEY);
    } catch {
      return null;
    }
  }
  function detect() {
    const saved = stored();
    if (saved in LANGS) return saved;
    const preferred = (navigator.languages?.length ? navigator.languages : [navigator.language || 'en'])[0];
    return String(preferred).toLowerCase().startsWith('uk') ? 'uk' : 'en';
  }

  let lang = detect();
  let exact = {},
    templates = new Map(),
    indexed = new Map(),
    generic = [];
  const cache = new Map();
  const format = (template, args) => template.replace(/\{(\d+)\}/g, (_, i) => (args[i] === undefined ? '' : args[i]));

  function compile(name) {
    const dictionary = dictionaries[name] || {};
    exact = dictionary.exact || {};
    templates = new Map();
    indexed = new Map();
    generic = [];
    cache.clear();
    for (const [source, target] of dictionary.patterns || []) {
      templates.set(source, target);
      const parts = source.split(/\{\d+\}/);
      if (parts.length < 2) continue;
      const order = [...source.matchAll(/\{(\d+)\}/g)].map(match => Number(match[1]));
      const pattern = new RegExp(
        '^' + parts.map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('([\\s\\S]+?)') + '$',
      );
      const entry = {pattern, order, target};
      const prefix = parts[0].slice(0, 3);
      if (prefix.length < 3) generic.push(entry);
      else if (indexed.has(prefix)) indexed.get(prefix).push(entry);
      else indexed.set(prefix, [entry]);
    }
  }

  // Captured values are translated too: exact first, then one more level of patterns
  // ("WAV failed · {0}" wrapping another interpolated message).
  function lookup(text, depth = 0) {
    if (Object.prototype.hasOwnProperty.call(exact, text)) return exact[text];
    for (const list of [indexed.get(text.slice(0, 3)), generic]) {
      if (!list) continue;
      for (const {pattern, order, target} of list) {
        const match = pattern.exec(text);
        if (!match) continue;
        const values = [];
        order.forEach((slot, position) => {
          const value = match[position + 1],
            key = value.trim();
          const inner = depth < 1 && /[A-Za-z]/.test(key) ? lookup(key, depth + 1) : null;
          values[slot] = inner === null ? value : value.replace(key, () => inner);
        });
        return format(target, values);
      }
    }
    return null;
  }

  function translate(source) {
    if (lang === 'en' || !source) return source;
    const hit = cache.get(source);
    if (hit !== undefined) return hit;
    let out = source;
    const match = /^(\s*)([\s\S]*?)(\s*)$/.exec(source);
    if (match[2] && /[A-Za-z]/.test(match[2])) {
      const found = lookup(match[2].replace(/\s+/g, ' '));
      if (found !== null) out = match[1] + found + match[3];
    }
    if (cache.size > 6000) cache.clear();
    cache.set(source, out);
    return out;
  }

  // For strings that bypass the DOM. t('Track {0} cleared', 3)
  function t(template, ...args) {
    if (lang === 'en') return format(template, args);
    const target = Object.prototype.hasOwnProperty.call(exact, template) ? exact[template] : templates.get(template);
    return format(target ?? template, args);
  }

  // node → {en, out}: lets a language change restore the English source and tells our own
  // writes apart from the app's.
  let texts = new WeakMap(),
    attributes = new WeakMap();
  const skipped = element => !element || SKIP_TAGS.has(element.tagName) || !!element.closest('[data-i18n-skip]');

  function applyText(node) {
    const state = texts.get(node);
    if (state && node.data === state.out) return;
    if (skipped(node.parentElement)) return;
    const en = node.data,
      out = translate(en);
    texts.set(node, {en, out});
    if (out !== en) node.data = out;
  }
  function applyAttribute(element, name) {
    const value = element.getAttribute(name);
    if (value === null) return;
    const states = attributes.get(element) || {};
    if (states[name] && value === states[name].out) return;
    if (skipped(element)) return;
    const out = translate(value);
    states[name] = {en: value, out};
    attributes.set(element, states);
    if (out !== value) element.setAttribute(name, out);
  }
  function applyTree(root) {
    if (root.nodeType === Node.TEXT_NODE) return applyText(root);
    if (root.nodeType !== Node.ELEMENT_NODE) return;
    for (const name of ATTRS) if (root.hasAttribute(name)) applyAttribute(root, name);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.nodeType === Node.TEXT_NODE) applyText(node);
      else for (const name of ATTRS) if (node.hasAttribute(name)) applyAttribute(node, name);
    }
  }
  function restoreTree(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.nodeType === Node.TEXT_NODE) {
        const state = texts.get(node);
        if (state && node.data === state.out) node.data = state.en;
      } else {
        const states = attributes.get(node);
        if (!states) continue;
        for (const [name, state] of Object.entries(states))
          if (node.getAttribute(name) === state.out) node.setAttribute(name, state.en);
      }
    }
    texts = new WeakMap();
    attributes = new WeakMap();
  }

  const observer = new MutationObserver(records => {
    for (const record of records) {
      if (record.type === 'characterData') applyText(record.target);
      else if (record.type === 'attributes') applyAttribute(record.target, record.attributeName);
      else for (const node of record.addedNodes) applyTree(node);
    }
  });
  function watch() {
    observer.observe(document.documentElement, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ATTRS,
    });
  }

  function paintPicker() {
    document.documentElement.lang = lang;
    const picker = document.getElementById('lang-select');
    if (!picker) return;
    if (picker.value !== lang) picker.value = lang;
    picker.parentElement.dataset.lang = lang === 'uk' ? 'ук' : lang;
  }
  function setLang(next) {
    if (!(next in LANGS) || next === lang) return;
    observer.disconnect();
    if (document.body) restoreTree(document.documentElement);
    lang = next;
    try {
      localStorage.setItem(KEY, next);
    } catch {
      /* Private mode keeps the language for this page only. */
    }
    compile(lang);
    if (lang !== 'en') {
      applyTree(document.documentElement);
      watch();
    }
    paintPicker();
    window.dispatchEvent(new CustomEvent('afterhours:lang', {detail: lang}));
  }

  compile(lang);
  // Loaded in <head> without defer: the observer translates the body while it is parsed,
  // so a translated interface never flashes English first.
  if (lang !== 'en') watch();
  document.documentElement.lang = lang;
  document.addEventListener('DOMContentLoaded', () => {
    paintPicker();
    document.getElementById('lang-select')?.addEventListener('change', event => setLang(event.target.value));
  });

  return {
    t,
    translate,
    setLang,
    languages: LANGS,
    get lang() {
      return lang;
    },
  };
})();
