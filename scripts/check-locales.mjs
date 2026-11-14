import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const LOCALES_DIR = path.join(ROOT_DIR, 'src', 'locales');
const REGISTRY_FILE = path.join(LOCALES_DIR, 'registry.ts');
const REFERENCE_LOCALE = 'de';

/**
 * Ermittelt aus src/locales/registry.ts, welche Sprachcodes als isBeta: true markiert sind.
 */
function readBetaLocales() {
  const betaSet = new Set();
  if (!fs.existsSync(REGISTRY_FILE)) return betaSet;

  const content = fs.readFileSync(REGISTRY_FILE, 'utf8');
  const entryRegex = /\{[^}]*code:\s*['"]([a-zA-Z-]+)['"][^}]*\}/g;
  let match;
  while ((match = entryRegex.exec(content)) !== null) {
    if (/isBeta:\s*true/.test(match[0])) {
      betaSet.add(match[1]);
    }
  }
  return betaSet;
}

/**
 * Flacht verschachtelte JSON-Objekte in Dot-Notation ab (z. B. html_export.btnReset).
 */
function flattenMessages(obj, prefix = '', out = new Map()) {
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
    out.set(prefix, obj);
    return out;
  }
  for (const [key, value] of Object.entries(obj)) {
    const nextKey = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      flattenMessages(value, nextKey, out);
    } else {
      out.set(nextKey, value);
    }
  }
  return out;
}

/**
 * Extrahiert vue-i18n Platzhalter wie {name}, {count}.
 */
function extractPlaceholders(text) {
  if (typeof text !== 'string') return [];
  const matches = text.match(/\{([a-zA-Z0-9_]+)\}/g) || [];
  return [...new Set(matches)].sort();
}

function main() {
  if (!fs.existsSync(LOCALES_DIR)) {
    console.error(`[check:locales] Verzeichnis nicht gefunden: ${LOCALES_DIR}`);
    process.exit(1);
  }

  const jsonFiles = fs
    .readdirSync(LOCALES_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort();

  const refFile = `${REFERENCE_LOCALE}.json`;
  if (!jsonFiles.includes(refFile)) {
    console.error(`[check:locales] Referenzdatei fehlt: ${refFile}`);
    process.exit(1);
  }

  const betaLocales = readBetaLocales();
  const parsedLocales = new Map();

  for (const file of jsonFiles) {
    const fullPath = path.join(LOCALES_DIR, file);
    try {
      const raw = fs.readFileSync(fullPath, 'utf8');
      const json = JSON.parse(raw);
      parsedLocales.set(file.replace(/\.json$/, ''), flattenMessages(json));
    } catch (err) {
      console.error(`[check:locales] Ungültiges JSON in ${file}: ${err.message}`);
      process.exit(1);
    }
  }

  const refMap = parsedLocales.get(REFERENCE_LOCALE);
  const totalRefKeys = refMap.size;
  let hasErrors = false;

  console.log(`[check:locales] Referenz: ${refFile} (${totalRefKeys} Keys)`);

  for (const [code, map] of parsedLocales.entries()) {
    const missing = [];
    const extra = [];
    const empty = [];
    const placeholderMismatches = [];

    for (const [key, refVal] of refMap.entries()) {
      if (!map.has(key)) {
        missing.push(key);
        continue;
      }
      const val = map.get(key);
      if (typeof val !== 'string' || val.trim() === '') {
        empty.push(key);
        continue;
      }
      const refPh = extractPlaceholders(refVal);
      const valPh = extractPlaceholders(val);
      if (refPh.join(',') !== valPh.join(',')) {
        placeholderMismatches.push({
          key,
          expected: refPh.join(', ') || '(keine)',
          actual: valPh.join(', ') || '(keine)',
        });
      }
    }

    for (const key of map.keys()) {
      if (!refMap.has(key)) {
        extra.push(key);
      }
    }

    const translatedCount = totalRefKeys - missing.length - empty.length;
    const coverage = totalRefKeys > 0 ? ((translatedCount / totalRefKeys) * 100).toFixed(1) : '100.0';
    const isBeta = betaLocales.has(code);
    const isBlockingMissing = missing.length > 0 && !isBeta;

    if (
      !isBlockingMissing &&
      extra.length === 0 &&
      empty.length === 0 &&
      placeholderMismatches.length === 0
    ) {
      const betaTag = isBeta && missing.length > 0 ? ` [Beta: ${missing.length} fehlend]` : '';
      console.log(`  ✓ ${code}.json — ${translatedCount}/${totalRefKeys} (${coverage}%)${betaTag}`);
      continue;
    }

    const prefix = isBeta && !extra.length && !empty.length && !placeholderMismatches.length ? '⚠' : '✗';
    console.log(`  ${prefix} ${code}.json — ${translatedCount}/${totalRefKeys} (${coverage}%)`);

    if (missing.length > 0) {
      if (!isBeta) hasErrors = true;
      console.log(`    - Fehlende Keys (${missing.length}): ${missing.slice(0, 10).join(', ')}${missing.length > 10 ? ', …' : ''}`);
    }
    if (extra.length > 0) {
      hasErrors = true;
      console.log(`    - Überzählige Keys (${extra.length}): ${extra.slice(0, 10).join(', ')}${extra.length > 10 ? ', …' : ''}`);
    }
    if (empty.length > 0) {
      hasErrors = true;
      console.log(`    - Leere Werte (${empty.length}): ${empty.slice(0, 10).join(', ')}${empty.length > 10 ? ', …' : ''}`);
    }
    if (placeholderMismatches.length > 0) {
      hasErrors = true;
      for (const m of placeholderMismatches.slice(0, 10)) {
        console.log(`    - Platzhalter-Fehler in "${m.key}": erwartet [${m.expected}], gefunden [${m.actual}]`);
      }
    }
  }

  if (hasErrors) {
    console.error('[check:locales] Prüfung fehlgeschlagen.');
    process.exit(1);
  }
}

main();
