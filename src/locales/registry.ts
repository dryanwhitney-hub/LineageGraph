export interface LocaleDefinition {
  /** Kurzer ISO-639-1 Sprachcode (z. B. 'de', 'en', 'fr', 'es') */
  code: string;
  /** Eigenname der Sprache (z. B. 'Deutsch', 'English', 'Français') */
  endonym: string;
  /** Vollständiger BCP-47 Tag für Intl-Formatierung & <html lang="..."> */
  bcp47: string;
  /** Babel-Paketname für den LaTeX-Export */
  latexBabel: string;
  /** Optionales Kennzeichen für noch unvollständige Übersetzungen */
  isBeta?: boolean;
}

/**
 * Zentrale Registry aller unterstützten App- und Export-Sprachen.
 * Neue Sprachen werden hier registriert und stehen automatisch UI & Exporten zur Verfügung.
 */
export const SUPPORTED_LOCALES = [
  {
    code: 'de',
    endonym: 'Deutsch',
    bcp47: 'de-DE',
    latexBabel: 'ngerman',
  },
  {
    code: 'en',
    endonym: 'English',
    bcp47: 'en-US',
    latexBabel: 'english',
  },
  {
    code: 'fr',
    endonym: 'Français',
    bcp47: 'fr-FR',
    latexBabel: 'french',
  },
  {
    code: 'pt',
    endonym: 'Português',
    bcp47: 'pt-PT',
    latexBabel: 'portuguese',
  },
] as const satisfies readonly LocaleDefinition[];

export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number]['code'];

export const LOCALE_STORAGE_KEY = 'lineagegraph.locale';
export const FALLBACK_LOCALE: SupportedLocale = 'en';

const LOCALE_MAP = new Map<string, LocaleDefinition>(
  SUPPORTED_LOCALES.map((entry) => [entry.code, entry])
);

/**
 * Prüft, ob ein Sprachcode in der Registry registriert ist.
 */
export function isSupportedLocale(code: string | null | undefined): code is SupportedLocale {
  if (!code) return false;
  return LOCALE_MAP.has(code);
}

/**
 * Normalisiert einen Sprach-Tag (z. B. 'de-DE', 'en_US', 'FR') auf einen
 * unterstützten Basis-Code oder gibt null zurück.
 */
export function resolveLocale(raw: string | null | undefined): SupportedLocale | null {
  if (!raw) return null;
  const normalized = raw.trim().toLowerCase().replace(/_/g, '-');
  if (!normalized) return null;

  if (isSupportedLocale(normalized)) return normalized;

  const base = normalized.split('-')[0];
  if (isSupportedLocale(base)) return base;

  return null;
}

/**
 * Liefert die vollständige Locale-Definition (mit Fallback auf den Standard).
 */
export function getLocaleDefinition(code: string | null | undefined): LocaleDefinition {
  const resolved = resolveLocale(code);
  if (resolved) {
    return LOCALE_MAP.get(resolved)!;
  }
  return LOCALE_MAP.get(FALLBACK_LOCALE) ?? SUPPORTED_LOCALES[0];
}

/**
 * Ermittelt die Startsprache:
 * 1. Gespeicherte Nutzerauswahl (localStorage)
 * 2. Browser-/Systemsprache (navigator.languages / navigator.language)
 * 3. Internationaler Fallback ('en')
 */
export function detectInitialLocale(): SupportedLocale {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const stored = resolveLocale(window.localStorage.getItem(LOCALE_STORAGE_KEY));
      if (stored) return stored;
    }
  } catch {
    // localStorage kann in restriktiven Umgebungen blockiert sein
  }

  if (typeof navigator !== 'undefined') {
    const candidates = Array.isArray(navigator.languages) && navigator.languages.length > 0
      ? navigator.languages
      : [navigator.language];

    for (const candidate of candidates) {
      const resolved = resolveLocale(candidate);
      if (resolved) return resolved;
    }
  }

  return FALLBACK_LOCALE;
}

/**
 * Persistiert die gewählte Sprache und aktualisiert das <html lang="..."> Attribut.
 */
export function persistLocale(code: SupportedLocale): void {
  const def = getLocaleDefinition(code);
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(LOCALE_STORAGE_KEY, def.code);
    }
  } catch {
    // Ignorieren, falls Storage nicht verfügbar
  }

  if (typeof document !== 'undefined' && document.documentElement) {
    document.documentElement.lang = def.bcp47;
  }
}

/**
 * Formatiert ein Date-Objekt konsistent über die Intl.DateTimeFormat API.
 */
export function formatDateByLocale(
  date: Date,
  locale: string | null | undefined,
  options: Intl.DateTimeFormatOptions = { year: 'numeric', month: '2-digit', day: '2-digit' }
): string {
  const { bcp47 } = getLocaleDefinition(locale);
  return new Intl.DateTimeFormat(bcp47, options).format(date);
}

/**
 * Formatiert eine Zahl konsistent über die Intl.NumberFormat API.
 */
export function formatNumberByLocale(
  value: number,
  locale: string | null | undefined,
  options?: Intl.NumberFormatOptions
): string {
  const { bcp47 } = getLocaleDefinition(locale);
  return new Intl.NumberFormat(bcp47, options).format(value);
}
