import { createI18n } from 'vue-i18n';
import de from './locales/de.json';
import en from './locales/en.json';

const messages = {
  de,
  en
};

const i18n = createI18n({
  legacy: false, // Verwende die Vue 3 Composition API
  locale: 'de',  // Standardsprache: Deutsch
  fallbackLocale: 'de',
  messages
});

export default i18n;