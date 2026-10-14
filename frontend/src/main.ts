import { mount } from 'svelte';
import App from './App.svelte';
import { setLocale } from './lib/i18n/index';
import { LANG_STORAGE_KEY, resolveLocale } from './lib/i18n/resolveLocale';
import { modelConfig } from './lib/model/config';
import { raiseLinkNotice } from './lib/state/notices.svelte';
import { parseUrl } from './lib/state/url';
import { viewState } from './lib/state/viewState.svelte';
import './styles/fonts.css';
import './styles/theme.css';
import './styles/global.css';

const target = document.getElementById('app');
if (!target) throw new Error('#app element missing from index.html');

// The state named by the address (contracts/url-state.md). The examples are not known yet: App
// checks the example once index.json is in, and the step once its core.json is.
const link = parseUrl(location.search, {
  exampleIds: null,
  nLayer: modelConfig.nLayer,
  nHead: modelConfig.nHead,
});
viewState.setMode(link.state.mode);
viewState.restore(link.state);
if (link.replaced.length > 0) raiseLinkNotice();

const { locale } = resolveLocale({
  urlLang: link.state.lang ?? null,
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
  .finally(() => mount(App, { target, props: { linkExample: link.state.exampleId } }));
