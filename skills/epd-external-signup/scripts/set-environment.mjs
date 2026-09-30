#!/usr/bin/env node
/**
 * Audits or rewrites every environment-specific URL in the skill.
 *
 * The skill deliberately hardcodes URLs rather than reading config, so the
 * templates stay copy-paste correct for any agent. The cost is that going live
 * means rewriting them in several files. This script does that in one step.
 *
 * Audit what is currently in use:
 *   node scripts/set-environment.mjs
 *
 * Fail if any dev host is still present (use as a pre-publish CI gate):
 *   node scripts/set-environment.mjs --check
 *
 * Rewrite for production:
 *   node scripts/set-environment.mjs \
 *     --api-base=https://api.example.com \
 *     --portal=https://portal.example.com
 */

import { readFileSync, writeFileSync, readdirSync, lstatSync } from 'node:fs';
import { join, relative, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const SELF = fileURLToPath(import.meta.url);
// The skill's own folder only (scripts/ -> skill root). Never go higher: when the
// skill is installed under ~/.claude/skills, a parent directory holds unrelated files.
const ROOT = join(SELF, '..', '..');

/** Hosts that must never appear in a published, live skill. */
const DEV_HOSTS = ['https://api-dev.dev1.epd.com', 'https://emap.epd.dev'];

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Exact URL, not a prefix of a longer host (https://x.com must not match https://x.com.evil). */
const exactUrl = (url) => new RegExp(escapeRe(url) + '(?![\\w.-])', 'g');

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (entry === '.git' || entry === 'node_modules') continue;
    const full = join(dir, entry);
    const stat = lstatSync(full);
    if (stat.isSymbolicLink()) continue; // never follow links out of the skill or into a cycle
    if (stat.isDirectory()) out.push(...walk(full));
    else if (/\.(md|html|tsx?|mjs|js)$/.test(entry) && full !== SELF) out.push(full);
  }
  return out;
}

const files = walk(ROOT);

/** The origin currently in use, read from the file that defines it. */
function currentOrigin(file, pattern, what) {
  const m = readFileSync(join(ROOT, file), 'utf8').match(pattern);
  if (!m) {
    console.error(`Cannot find the current ${what} in ${file}. Restore it before running this script.`);
    process.exit(1);
  }
  return m[1];
}

/**
 * What each slot means. `match` is the exact URL now in use, so only the skill's
 * own URLs are ever touched: unrelated https://api.* links are left alone.
 */
const SLOTS = [
  {
    flag: 'api-base',
    label: 'API base',
    detail: 'EPD_API_BASE in every template; the URL the form posts to',
    match: exactUrl(
      currentOrigin('assets/form.html', /EPD_API_BASE\s*=\s*'(https:\/\/[^'\/]+)'/, 'EPD_API_BASE')
    ),
  },
  {
    flag: 'portal',
    label: 'Partner portal',
    detail: 'where partners register and find their partner key',
    match: exactUrl(
      currentOrigin('SKILL.md', /partner portal at (https:\/\/[^\s\/)]+)/, 'partner portal URL')
    ),
  },
];

function findAll() {
  const found = new Map(SLOTS.map((s) => [s.flag, new Map()]));
  for (const file of files) {
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      for (const slot of SLOTS) {
        for (const url of line.match(slot.match) ?? []) {
          const hits = found.get(slot.flag);
          if (!hits.has(url)) hits.set(url, []);
          hits.get(url).push(`${relative(ROOT, file)}:${i + 1}`);
        }
      }
    });
  }
  return found;
}

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, '').split('=');
    return [k, v.join('=') || true];
  })
);

const found = findAll();

// --- audit ------------------------------------------------------------------
if (!args['api-base'] && !args.portal) {
  let devFound = 0;

  for (const slot of SLOTS) {
    const hits = found.get(slot.flag);
    console.log(`\n${slot.label}  (--${slot.flag})`);
    console.log(`  ${slot.detail}`);
    if (hits.size === 0) {
      console.log('  (none found)');
      continue;
    }
    for (const [url, locations] of hits) {
      const isDev = DEV_HOSTS.some((h) => url.startsWith(h));
      if (isDev) devFound += locations.length;
      console.log(`\n  ${url}${isDev ? '   <- DEV' : ''}`);
      for (const loc of locations) console.log(`      ${loc}`);
    }
  }

  if (args.check) {
    if (devFound > 0) {
      console.error(
        `\n${devFound} reference(s) still point at a dev host. ` +
          `Rewrite them before publishing:\n` +
          `  node scripts/set-environment.mjs --api-base=<url> --portal=<url>`
      );
      process.exit(1);
    }
    console.log('\nNo dev hosts found. Safe to publish.');
  } else {
    console.log(
      `\nTo rewrite:\n  node ${basename(SELF)} --api-base=<url> --portal=<url>`
    );
  }
  process.exit(0);
}

// --- rewrite ----------------------------------------------------------------
for (const [flag, value] of Object.entries(args)) {
  if (flag === 'check') continue;
  if (!SLOTS.some((s) => s.flag === flag)) {
    console.error(`Unknown flag --${flag}. Expected: ${SLOTS.map((s) => '--' + s.flag).join(', ')}`);
    process.exit(1);
  }
  if (typeof value !== 'string' || !/^https:\/\/[^/]+$/.test(value)) {
    console.error(`--${flag} must be an https origin with no trailing path, e.g. https://api.example.com`);
    process.exit(1);
  }
}

let changed = 0;
const touched = new Set();

for (const file of files) {
  const before = readFileSync(file, 'utf8');
  let after = before;

  for (const slot of SLOTS) {
    const target = args[slot.flag];
    if (!target) continue;
    after = after.replace(slot.match, (url) => {
      if (url === target) return url;
      changed++;
      return target;
    });
  }

  if (after !== before) {
    writeFileSync(file, after);
    touched.add(relative(ROOT, file));
  }
}

console.log(`Rewrote ${changed} URL(s) across ${touched.size} file(s):`);
for (const f of [...touched].sort()) console.log(`  ${f}`);
console.log('\nVerify the result:\n  node scripts/set-environment.mjs --check');
