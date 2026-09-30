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

const TIMEOUT_MESSAGE =
  'This is taking longer than expected. Check your inbox: if a code arrived, your signup went through. If not, please try again.';

export async function POST(req: NextRequest) {
  // Only this site's own pages may call this route. A browser always sends Origin
  // on a cross-site POST, so a mismatch means another site is driving the visitor.
  const origin = req.headers.get('origin');
  if (origin) {
    let sameSite = false;
    try {
      sameSite = new URL(origin).host === req.headers.get('host');
    } catch {}
    if (!sameSite) {
      return NextResponse.json({ success: false, message: 'Forbidden.' }, { status: 403 });
    }
  }

  // JSON only. A cross-site page cannot send this content type without a CORS
  // preflight, which this route never answers.
  if (!req.headers.get('content-type')?.includes('application/json')) {
    return NextResponse.json(
      { success: false, message: 'Content-Type must be application/json.' },
      { status: 415 }
    );
  }

  let raw: Record<string, unknown>;
  try {
    const parsed: unknown = await req.json();
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
    raw = parsed as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { success: false, message: 'Malformed request body.' },
      { status: 400 }
    );
  }

  // Rebuild the body from a whitelist. Never forward the client's object as-is:
  // the API rejects unrecognized properties.
  const body: Record<string, string | Record<string, string>> = {
    firstName: str(raw.firstName, 20),
    lastName: str(raw.lastName, 20),
    companyName: str(raw.companyName, 150),
    email: str(raw.email, 254),
  };

  // UTM and ad click-ID attribution. The visitor's page URL lives in the browser, not here, so
  // the client resolved these already. Forward what it sent and invent nothing:
  // a value the URL did not carry is simply absent.
  for (const key of ['utmSource', 'utmMedium', 'utmCampaign', 'utmTerm', 'utmContent'] as const) {
    const value = str(raw[key], MAX_UTM_LENGTH);
    if (value) body[key] = value;
  }

  // Ad click IDs travel inside utmParams: the API has no top-level field for them
  // and rejects unrecognized properties.
  const clickIds = (raw.utmParams ?? {}) as Record<string, unknown>;
  const utmParams: Record<string, string> = {};
  for (const key of ['gclid', 'gbraid', 'wbraid', 'fbclid'] as const) {
    const value = str(clickIds[key], MAX_UTM_LENGTH);
    if (value) utmParams[key] = value;
  }
  if (Object.keys(utmParams).length > 0) body.utmParams = utmParams;

  // Partner key, set in the form's PARTNER_KEY. Forwarded when present.
  const partnerKey = str(raw.partnerKey, 100);
  if (partnerKey) body.partnerKey = partnerKey;

  // EPD rate limits 60 requests per hour per IP. This header asks EPD to count the
  // visitor's IP instead of your server's. Do not rely on it: any caller can set
  // X-Forwarded-For, so EPD is expected to stop trusting it from outside its own
  // proxies. Once it does, every visitor counts against your server's single IP
  // and the whole site stops at 60 signups an hour. Add your own per-visitor
  // throttle here before relying on this route for real traffic.
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
          ? TIMEOUT_MESSAGE
          : 'Signup service is unavailable. Please try again.',
      },
      { status: 502 }
    );
  } finally {
    clearTimeout(timeout);
  }
}
