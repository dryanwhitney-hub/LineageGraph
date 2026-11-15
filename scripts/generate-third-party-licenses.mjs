#!/usr/bin/env node
/**
 * Generates THIRD_PARTY_LICENSES.txt from package-lock.json (production npm
 * packages) and `cargo metadata` (Rust crates in src-tauri/Cargo.toml).
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const OUTPUT_PATH = path.join(ROOT_DIR, 'THIRD_PARTY_LICENSES.txt');

const LICENSE_FILE_PATTERN = /^(license|licence|notice|copying)(\..*)?$/i;

/**
 * Collects full text of any LICENSE / NOTICE / COPYING files in `dir`.
 * @param {string} dir
 * @returns {Array<{ filename: string, content: string }>}
 */
function readLicenseFiles(dir) {
  if (!dir || !fs.existsSync(dir)) return [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isFile() && LICENSE_FILE_PATTERN.test(e.name))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((e) => ({
      filename: e.name,
      content: fs.readFileSync(path.join(dir, e.name), 'utf8').replace(/\r\n/g, '\n').trim(),
    }))
    .filter((f) => f.content.length > 0);
}

/**
 * Extracts production npm packages from package-lock.json.
 */
function collectNpmComponents() {
  const lockPath = path.join(ROOT_DIR, 'package-lock.json');
  const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  const packages = lock.packages || {};
  const result = [];

  for (const [pkgPath, meta] of Object.entries(packages)) {
    if (!pkgPath || meta.dev) continue;
    const name = meta.name || pkgPath.replace(/^node_modules\//, '');
    const license = meta.license || 'UNKNOWN';
    const dir = path.join(ROOT_DIR, pkgPath);
    const licenseFiles = readLicenseFiles(dir);
    result.push({
      ecosystem: 'npm',
      name,
      version: meta.version || 'UNKNOWN',
      license,
      repository: '',
      licenseFiles,
    });
  }

  return result.sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
}

/**
 * Extracts Rust crate dependencies via `cargo metadata`.
 */
function collectCargoComponents() {
  const manifestPath = path.join(ROOT_DIR, 'src-tauri', 'Cargo.toml');
  const raw = execFileSync(
    'cargo',
    ['metadata', '--format-version', '1', '--manifest-path', manifestPath],
    { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }
  );
  const meta = JSON.parse(raw);
  const rootId = meta.resolve?.root;
  const result = [];

  for (const pkg of meta.packages || []) {
    if (pkg.id === rootId || pkg.name === 'lineagegraph') continue;
    const crateDir = pkg.manifest_path ? path.dirname(pkg.manifest_path) : '';
    const licenseFiles = readLicenseFiles(crateDir);
    let license = pkg.license || pkg.license_file || 'UNKNOWN';
    let note = '';
    if (pkg.name === 'r-efi' && license.includes('LGPL-2.1-or-later')) {
      note = 'Selected license option: MIT (from MIT OR Apache-2.0 OR LGPL-2.1-or-later)';
    }
    result.push({
      ecosystem: 'cargo',
      name: pkg.name,
      version: pkg.version,
      license,
      repository: pkg.repository || '',
      note,
      licenseFiles,
    });
  }

  return result.sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
}

/**
 * Formats a single component block for THIRD_PARTY_LICENSES.txt.
 */
function formatComponent(comp) {
  const lines = [
    `--------------------------------------------------------------------------------`,
    `Component:  ${comp.name} (${comp.version}) [${comp.ecosystem}]`,
    `License:    ${comp.license}`,
  ];
  if (comp.repository) {
    lines.push(`Source:     ${comp.repository}`);
  }
  if (comp.note) {
    lines.push(`Note:       ${comp.note}`);
  }
  if (comp.licenseFiles.length > 0) {
    for (const lf of comp.licenseFiles) {
      lines.push('', `[${lf.filename}]`, lf.content);
    }
  } else {
    lines.push(`Notice:     No separate LICENSE/NOTICE file bundled in package archive; governed by ${comp.license}.`);
  }
  lines.push('');
  return lines.join('\n');
}

function main() {
  const pkgJson = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'package.json'), 'utf8'));
  const npmComponents = collectNpmComponents();
  const cargoComponents = collectCargoComponents();
  const mplComponents = cargoComponents.filter((c) => c.license.toUpperCase().includes('MPL-2.0'));

  const header = [
    `LINEAGEGRAPH - THIRD-PARTY SOFTWARE NOTICES AND LICENSES`,
    `================================================================================`,
    `Product:    LineageGraph v${pkgJson.version}`,
    `Copyright:  Copyright (c) 2026 David Whitney. All rights reserved.`,
    ``,
    `LineageGraph itself is proprietary software governed by LICENSE.txt.`,
    `The following third-party open-source components are incorporated into`,
    `LineageGraph and remain subject to their respective original licenses.`,
    ``,
    `Summary:`,
    `- Production npm packages: ${npmComponents.length}`,
    `- Rust crates (Cargo):     ${cargoComponents.length}`,
    ``,
    `Weak Copyleft (MPL-2.0) Source Availability Notice:`,
    `The following components are licensed under the Mozilla Public License 2.0`,
    `(MPL-2.0) and are included in unmodified form. Their source code is available`,
    `at their respective upstream repositories listed below:`,
    ...mplComponents.map((c) => `  * ${c.name} v${c.version}: ${c.repository || 'https://crates.io/crates/' + c.name}`),
    ``,
  ].join('\n');

  const sections = [
    header,
    `================================================================================`,
    `PART 1: NPM PRODUCTION DEPENDENCIES (${npmComponents.length})`,
    `================================================================================\n`,
    ...npmComponents.map(formatComponent),
    `================================================================================`,
    `PART 2: RUST CRATE DEPENDENCIES (${cargoComponents.length})`,
    `================================================================================\n`,
    ...cargoComponents.map(formatComponent),
  ];

  fs.writeFileSync(OUTPUT_PATH, sections.join('\n'), 'utf8');
  console.log(
    `Generated ${path.relative(ROOT_DIR, OUTPUT_PATH)} (${npmComponents.length} npm, ${cargoComponents.length} cargo, ${mplComponents.length} MPL-2.0).`
  );
}

main();
