/**
 * EPD external signup - Next.js route handler (App Router). Optional.
 *
 * Use it only when signups should go through the site's own server. The form
 * works without it, posting straight to EPD.
 *
 * Save as:
 *   app/api/epd-signup/route.ts       when the project has a root app/ folder
 *   src/app/api/epd-signup/route.ts   when the project keeps app/ under src/
 * Never create a root app/ folder in a src/app project: Next.js then ignores src/app.
 *
 * Pair with: assets/form.tsx, with its ENDPOINT set to '/api/epd-signup'.
 * The partner key stays in the form's PARTNER_KEY; this route forwards it.
 *
 * Change only EPD_API_BASE.
 */

import { NextRequest, NextResponse } from 'next/server';

const EPD_API_BASE = 'https://api-dev.dev1.epd.com';

const TIMEOUT_MS = 10_000;
const MAX_UTM_LENGTH = 100;

function str(value: unknown, maxLength: number): string {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

export async function POST(req: NextRequest) {
  let raw: Record<string, unknown>;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json(
      { success: false, message: 'Malformed request body.' },
      { status: 400 }
    );
  }

  // Rebuild the body from a whitelist. Never forward the client's object as-is:
  // the API rejects unrecognized properties.
  const body: Record<string, string> = {
    firstName: str(raw.firstName, 20),
    lastName: str(raw.lastName, 20),
    companyName: str(raw.companyName, 150),
    email: str(raw.email, 254),
  };

  // UTM and ad click-ID attribution. The visitor's page URL lives in the browser, not here, so
  // the client resolved these already. Forward what it sent and invent nothing:
  // a value the URL did not carry is simply absent.
  for (const key of [
    'utmSource',
    'utmMedium',
    'utmCampaign',
    'utmTerm',
    'utmContent',
    'gclid',
    'gbraid',
    'wbraid',
    'fbclid',
  ] as const) {
    const value = str(raw[key], MAX_UTM_LENGTH);
    if (value) body[key] = value;
  }

  // Partner key, set in the form's PARTNER_KEY. Forwarded when present.
  const partnerKey = str(raw.partnerKey, 100);
  if (partnerKey) body.partnerKey = partnerKey;

  // EPD rate limits 60 requests per hour per IP. Without this header every
  // visitor shares your server's single IP and the whole site stops at 60 an
  // hour. Confirm the backend honours it; if it does not, add your own
  // per-visitor throttle here.
  const visitorIp =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    req.headers.get('x-real-ip') ??
    '';

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(`${EPD_API_BASE}/v1/external-signup`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(visitorIp ? { 'X-Forwarded-For': visitorIp } : {}),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const data = await res.json().catch(() => null);

    // Pass EPD's status through so the client can branch on 400 and 429, and
    // Retry-After so a 429 can tell the visitor how long to wait.
    const retryAfter = res.headers.get('retry-after');
    return NextResponse.json(data ?? { success: res.ok }, {
      status: res.status,
      headers: retryAfter ? { 'Retry-After': retryAfter } : undefined,
    });
  } catch (err) {
    const timedOut = err instanceof Error && err.name === 'AbortError';
    return NextResponse.json(
      {
        success: false,
        message: timedOut
          ? 'Signup service timed out. Please try again.'
          : 'Signup service is unavailable. Please try again.',
      },
      { status: 502 }
    );
  } finally {
    clearTimeout(timeout);
  }
}
