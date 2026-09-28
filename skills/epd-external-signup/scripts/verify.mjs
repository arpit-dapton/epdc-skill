#!/usr/bin/env node
/**
 * Verifies a generated EPD signup file.
 *
 * Usage: node verify.mjs <path> [<path> ...]
 *
 * Exits 0 if everything passes, 1 if anything failed.
 * Run this after copying a template, before telling the user you are done.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const REQUIRED_FIELDS = ['firstName', 'lastName', 'companyName', 'email'];

const ROUTE_PATHS = [
  'app/api/epd-signup/route.ts',
  'app/api/epd-signup/route.js',
  'src/app/api/epd-signup/route.ts',
  'src/app/api/epd-signup/route.js',
  'pages/api/epd-signup.ts',
  'pages/api/epd-signup.js',
  'src/pages/api/epd-signup.ts',
  'src/pages/api/epd-signup.js',
];

// A route handler counts if it was passed in alongside the form, or sits at a
// standard Next.js path in the form's directory or any parent of it.
function hasRouteHandler(file) {
  const passedIn = files.some((f) => {
    try {
      return /from ['"]next\/server['"]/.test(readFileSync(f, 'utf8'));
    } catch {
      return false;
    }
  });
  if (passedIn) return true;

  let dir = dirname(resolve(file));
  while (true) {
    if (ROUTE_PATHS.some((p) => existsSync(join(dir, p)))) return true;
    const parent = dirname(dir);
    if (parent === dir) return false;
    dir = parent;
  }
}

const checks = [
  {
    name: 'required field names present',
    applies: (src) => /<(form|input)/i.test(src),
    run: (src) => {
      const missing = REQUIRED_FIELDS.filter(
        (f) => !new RegExp(`name=["']${f}["']`).test(src)
      );
      return missing.length ? `missing field(s): ${missing.join(', ')}` : null;
    },
  },
  {
    name: 'every input has a label',
    applies: (src) => /<input/i.test(src),
    run: (src) => {
      // id="epd-email" in HTML, or id={`${id}-email`} from useId in React.
      const ids = [...src.matchAll(/<input[^>]*\sid=("[^"]+"|'[^']+'|\{[^}]*\}(?:[^}\s]*\})?)/gi)].map(
        (m) => m[1]
      );
      const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const unlabelled = ids.filter((id) => !new RegExp(`(for|htmlFor)=${escape(id)}`).test(src));
      return unlabelled.length
        ? `no label for: ${unlabelled.map((id) => id.replace(/^["']|["']$/g, '')).join(', ')}`
        : null;
    },
  },
  {
    // iOS and macOS smart punctuation types ’. The API rejects it, and so does
    // the name pattern, which blocks the submit with no useful message.
    name: 'curly apostrophes in names are converted',
    // The file that submits, not markup split out from its script.
    applies: (src) => /firstName/.test(src) && /new FormData\(/.test(src),
    run: (src) =>
      /\\u2019/.test(src) ? null : "the ’ to ' conversion for firstName/lastName was removed",
  },
  {
    // Without method="post", a form whose script was stripped (or a copy the
    // script never set up) falls back to a GET with the visitor's details in the URL.
    name: 'form posts, never GETs',
    applies: (src) => /<form/i.test(src),
    // `=>` is skipped so an arrow function in onSubmit does not end the tag early.
    run: (src) =>
      /<form\b(?:=>|[^>])*\smethod=["']post["']/i.test(src)
        ? null
        : 'the <form> lost method="post"; if the script does not run, details land in the URL',
  },
  {
    // form.html used to look itself up by id, so a second copy on the page was
    // never set up and submitted natively.
    name: 'every copy of the form is set up',
    applies: (src) => /<script/i.test(src) && /<form/i.test(src),
    run: (src) =>
      /getElementById\(\s*['"]epd-signup['"]\s*\)/.test(src)
        ? 'the script finds the form by id, so a second copy on the page is never set up'
        : null,
  },
  {
    // A button with type="button", or a link styled as one, cannot submit.
    name: 'form has a submit button',
    applies: (src) => /<form/i.test(src),
    run: (src) =>
      /<button\b(?![^>]*\stype=["'](button|reset)["'])|<input\b[^>]*\stype=["']submit["']/i.test(src)
        ? null
        : 'no submit button in the form; keep a <button> without type="button" (or type="submit")',
  },
  {
    // A script placed above the form (in <head>, or enqueued by a theme) runs
    // before the form exists, finds nothing, and the browser submits natively.
    name: 'script waits for the page before looking for the form',
    applies: (src) => /form\[data-epd-signup/.test(src),
    run: (src) =>
      /DOMContentLoaded|readyState/.test(src)
        ? null
        : 'the script looks for the form immediately; if it sits above the form it never binds. Recopy assets/form.html',
  },
  {
    // Restyling swaps in the site's own button (no type="submit") or error text
    // (no role="alert"). An exact-attribute lookup then returns null and the
    // submit handler crashes after preventDefault: the visitor sees nothing.
    name: 'button and message area survive restyling',
    applies: (src) => /form\[data-epd-signup/.test(src),
    run: (src) => {
      if (/querySelector\(\s*['"]button\[type=["']submit["']\]['"]\s*\)/.test(src)) {
        return 'the script only finds button[type="submit"]; a restyled button without it leaves the form dead. Recopy assets/form.html';
      }
      if (/\[role=["']alert["']\]/.test(src) && !/createElement\(/.test(src)) {
        return 'the script needs an element with role="alert" and does not create one; without it the form is dead. Recopy assets/form.html';
      }
      return null;
    },
  },
  {
    // Back button after the redirect restores the page from cache with the
    // submit button still disabled.
    name: 'submit button re-enabled on back navigation',
    applies: (src) => /disabled/.test(src) && /redirectUrl/.test(src),
    run: (src) =>
      /pageshow/.test(src) ? null : 'no pageshow handler; the button stays disabled after Back',
  },
  {
    name: 'honeypot field present',
    applies: (src) => /<form/i.test(src),
    run: (src) => (/name=["']website["']/.test(src) ? null : 'honeypot field was removed'),
  },
  {
    name: 'no raw FormData spread into the request body',
    applies: () => true,
    run: (src) =>
      /\.\.\.Object\.fromEntries\s*\(\s*(new\s+)?FormData|\.\.\.formData/i.test(src)
        ? 'spreading FormData leaks unrecognized keys and causes a 400'
        : null,
  },
  {
    // Client-side files read the UTM and click-ID params off the page URL.
    name: 'UTM block reads the page URL',
    applies: (src) => /URLSearchParams/.test(src),
    run: (src) => {
      const missing = [
        'utm_source',
        'utm_medium',
        'utm_campaign',
        'utm_term',
        'utm_content',
        'gclid',
        'gbraid',
        'wbraid',
        'fbclid',
      ].filter((t) => !src.includes(t));
      return missing.length ? `UTM block edited, missing: ${missing.join(', ')}` : null;
    },
  },
  {
    // Nothing is invented: a UTM or click-ID value is forwarded only when the URL carried it.
    name: 'UTM values are sent only when present',
    applies: (src) => /utm(Source|Medium|Campaign|Term|Content)/.test(src),
    run: (src) => {
      const missing = [
        'utmSource',
        'utmMedium',
        'utmCampaign',
        'utmTerm',
        'utmContent',
        'gclid',
        'gbraid',
        'wbraid',
        'fbclid',
      ].filter((k) => !src.includes(k));
      if (missing.length) return `UTM block edited, missing: ${missing.join(', ')}`;

      // Any non-empty literal defaulted onto a UTM line invents attribution.
      // `|| ''` is fine: that is the "no value" case.
      const hardcoded = src
        .split('\n')
        .find((line) => /utm|gclid|gbraid|wbraid|fbclid/i.test(line) && /(\|\||\?\?)\s*['"][^'"]+['"]/.test(line));
      return hardcoded
        ? `hardcoded UTM fallback: ${hardcoded.trim()} - send nothing when the URL has no value`
        : null;
    },
  },
  {
    name: 'UTM values are never written back to the URL',
    applies: () => true,
    run: (src) =>
      /history\.(replaceState|pushState)/.test(src)
        ? 'UTM reads are read-only; do not rewrite the URL or history'
        : null,
  },
  {
    name: 'redirectUrl is guarded before navigating',
    applies: (src) => src.includes('redirectUrl'),
    run: (src) =>
      /!\s*(data\s*\??\.\s*)?redirectUrl\b|!data\s*\|\|\s*!data\.redirectUrl|redirectUrl\s*\?(?![:.?])/.test(src)
        ? null
        : 'navigating to redirectUrl without checking it exists',
  },
  {
    // form.tsx can post to its own route handler. Pointed there without
    // route.ts, every submit 404s. Anchored to the line start so the example in
    // the doc comment does not count.
    name: 'ENDPOINT has a route handler behind it',
    applies: (src) => /^const ENDPOINT\s*=\s*['"]\/api\/epd-signup['"]/m.test(src),
    run: (_src, file) =>
      hasRouteHandler(file)
        ? null
        : "ENDPOINT is '/api/epd-signup' but no route handler was found. Copy assets/route.ts " +
          'to app/api/epd-signup/route.ts (src/app/api/epd-signup/route.ts in a src/app project), ' +
          'or set ENDPOINT back to `${EPD_API_BASE}/v1/external-signup`',
  },
  {
    // A 429 should tell the visitor how long to wait. route.ts has to pass the
    // header on, or the form never sees it.
    name: 'rate limit reads Retry-After',
    applies: (src) => /429/.test(src),
    run: (src) =>
      /headers\s*(\.get\(\s*|\[\s*)['"]retry-after['"]/i.test(src)
        ? null
        : 'a 429 is handled without Retry-After, so the visitor is not told how long to wait',
  },
  {
    // EPD returns { error: { field_errors: [{ field, message }] } }. Reading a
    // top-level field_errors or messages[0] silently shows only the generic error.
    name: 'reads EPD error shape',
    applies: (src) => /!res\.ok/.test(src),
    run: (src) => {
      if (/\.messages\??\.?\[0\]/.test(src)) {
        return 'reads field_errors[].messages[0]; EPD sends a single `message` per field error';
      }
      if (/data\s*(\?\.|&&\s*data\.|\.)\s*field_errors/.test(src)) {
        return 'reads a top-level field_errors; EPD nests it under `error`';
      }
      return /field_errors/.test(src)
        ? null
        : 'does not read error.field_errors, so visitors never see which field was rejected';
    },
  },
  {
    // The key is public, so it lives in the form as a plain string. An env var
    // that is missing (or not exposed to the browser) silently drops it.
    name: 'partner key is a plain string',
    applies: (src) => /PARTNER_KEY|partnerKey/.test(src),
    run: (src) => {
      if (/(PARTNER_KEY|partnerKey)\s*[:=][^\n;]*process\.env/.test(src)) {
        return 'partner key read from process.env; set PARTNER_KEY to the key as a string';
      }
      const value = src.match(/const PARTNER_KEY\s*=\s*['"]([^'"]*)['"]/);
      if (/const PARTNER_KEY/.test(src) && !value) {
        return 'PARTNER_KEY must be a quoted string, or \'\' for no key';
      }
      if (value && /authorization|replace|\s|:/i.test(value[1])) {
        return `PARTNER_KEY "${value[1]}" is not a bare key; paste only the value after "API Key - Authorization:"`;
      }
      return null;
    },
  },
  {
    // The body is built from named fields, so an input called partnerKey is
    // never sent and the commission is silently lost.
    name: 'partner key is not a form field',
    applies: () => true,
    run: (src) =>
      /name=["']partnerKey["']/.test(src)
        ? 'partnerKey as an input is never sent; set PARTNER_KEY in the script instead'
        : null,
  },
  {
    name: 'base URL points somewhere real',
    // Where it is assigned, not a mention in a comment.
    applies: (src) => /EPD_API_BASE\s*=/.test(src),
    run: (src) =>
      /EPD_API_BASE\s*=\s*['"]https:\/\/[^'"]+['"]/.test(src)
        ? null
        : 'EPD_API_BASE is missing or not an https URL',
  },
  {
    name: 'no env plumbing for the base URL',
    applies: () => true,
    run: (src) =>
      /process\.env\.[A-Z_]*(API_BASE|BASE_URL|EPD_URL)/.test(src)
        ? 'the base URL is hardcoded by design, not an env var'
        : null,
  },
];

const files = process.argv.slice(2);

if (files.length === 0) {
  console.error('usage: node verify.mjs <path> [<path> ...]');
  process.exit(1);
}

let failed = 0;

for (const file of files) {
  let src;
  try {
    src = readFileSync(file, 'utf8');
  } catch {
    console.error(`FAIL ${file}: cannot read file`);
    failed++;
    continue;
  }

  const problems = [];
  for (const check of checks) {
    if (!check.applies(src)) continue;
    const problem = check.run(src, file);
    if (problem) problems.push(`${check.name}: ${problem}`);
  }

  if (problems.length === 0) {
    console.log(`PASS ${file}`);
  } else {
    failed++;
    console.error(`FAIL ${file}`);
    for (const problem of problems) console.error(`  - ${problem}`);
  }
}

if (failed > 0) {
  console.error(`\n${failed} file(s) failed. Fix these before reporting done.`);
  process.exit(1);
}

console.log('\nAll checks passed.');
