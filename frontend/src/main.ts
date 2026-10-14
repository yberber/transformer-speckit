import { mount } from 'svelte';
import App from './App.svelte';
import { setLocale } from './lib/i18n/index';
import { LANG_STORAGE_KEY, resolveLocale } from './lib/i18n/resolveLocale';
import { viewState } from './lib/state/viewState.svelte';
import './styles/fonts.css';
import './styles/theme.css';
import './styles/global.css';

const target = document.getElementById('app');
if (!target) throw new Error('#app element missing from index.html');

const { locale } = resolveLocale({
  stored: () => globalThis.localStorage?.getItem(LANG_STORAGE_KEY),
  navigatorLanguages: navigator.languages,
});

// Mount once the catalog is loaded, so a Turkish or German visitor never sees English first. If
// it cannot be loaded, the site starts in English (bundled) rather than not at all.
viewState.lang = locale;
setLocale(locale)
  .catch(() => {
    viewState.lang = 'en';
  })
  .finally(() => mount(App, { target }));
