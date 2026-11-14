import { createI18n } from 'vue-i18n';
import de from './locales/de.json';
import en from './locales/en.json';
import fr from './locales/fr.json';
import pt from './locales/pt.json';
import {
  detectInitialLocale,
  getLocaleDefinition,
  persistLocale,
  resolveLocale,
  type SupportedLocale,
} from './locales/registry';

const messages = {
  de,
  en,
  fr,
  pt,
};

const initialLocale = detectInitialLocale();

if (typeof document !== 'undefined' && document.documentElement) {
  document.documentElement.lang = getLocaleDefinition(initialLocale).bcp47;
}

const i18n = createI18n({
  legacy: false, // Verwende die Vue 3 Composition API
  locale: initialLocale,
  fallbackLocale: {
    default: ['en', 'de'],
  },
  messages,
});

/**
 * Setzt die globale App-Sprache, persistiert sie und aktualisiert <html lang="...">.
 */
export function setAppLocale(lang: string): SupportedLocale {
  const resolved = resolveLocale(lang) ?? initialLocale;
  i18n.global.locale.value = resolved;
  persistLocale(resolved);
  return resolved;
}

/**
 * Übersetzt einen Key gezielt für eine bestimmte Ziel-Locale (z. B. für Exporte oder Domain-Resolver),
 * ohne die globale App-Sprache zu verändern.
 */
export function tLocale(
  key: string,
  targetLocale?: string | null,
  named?: Record<string, unknown>
): string {
  const resolved = resolveLocale(targetLocale) ?? i18n.global.locale.value;
  return named
    ? i18n.global.t(key, named, { locale: resolved })
    : i18n.global.t(key, {}, { locale: resolved });
}

export default i18n;