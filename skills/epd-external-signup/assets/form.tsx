'use client';

/**
 * EPD external signup form - React / Next.js client component.
 *
 * Copy this file as-is. Change only:
 *   1. PARTNER_KEY, if the user gave one. See references/partner-key.md.
 *   2. ENDPOINT, only when you are also copying route.ts (see below)
 *   3. the styling, to match the host page
 *
 * Do not rename the fields, drop the honeypot, or edit the UTM block.
 */

import { useEffect, useId, useState } from 'react';

const EPD_API_BASE = 'https://api-dev.dev1.epd.com';

// Your EasyPayDirect partner key (Integration → API Integration → Partner key).
// Leave '' for no key. Never the "API Key - Authorization" value: that is secret.
// A plain string, not an env var: a missing env var silently drops the key.
const PARTNER_KEY = '';

/**
 * Where this form posts. By default, straight to EPD.
 *
 * Only if you also copied assets/route.ts, change this to:
 *   const ENDPOINT = '/api/epd-signup';
 */
const ENDPOINT = `${EPD_API_BASE}/v1/external-signup`;

type FieldError = { field?: string; code?: string; message?: string };
type SignupResponse = {
  alreadyRegistered?: boolean;
  redirectUrl?: string;
  // EPD's error body.
  error?: { message?: string; field_errors?: FieldError[] };
  // route.ts's own errors (malformed body, timeout).
  message?: string;
};

const FORM_FIELDS = [
  'firstName',
  'lastName',
  'companyName',
  'email',
  'country',
  'industry',
  'industryOther',
  'estimatedYearlySales',
  'website',
  'cardPaymentMethod',
];

// EPD's id for the "Other" industry, which needs industryOther filled in.
const INDUSTRY_OTHER = '53';

const CARD_PAYMENT_METHODS = [
  ['not_accepting_yet', 'Not accepting payments yet'],
  ['stripe', 'Stripe'],
  ['paypal', 'PayPal'],
  ['square', 'Square'],
  ['shopping_cart_or_funnel', 'A shopping cart or funnel'],
  ['another_processor', 'Another processor'],
] as const;

// Country and industry options, loaded once and shared by every copy of the form.
// EPD answers { data: [{ id, name }] }.
type ListOption = { id: number; name: string };
const lists: Record<string, Promise<ListOption[]> | undefined> = {};
function loadList(key: 'countries' | 'industryTypes'): Promise<ListOption[]> {
  lists[key] ??= fetch(`${EPD_API_BASE}/emap/lists/${key}`)
    .then((res) => {
      if (!res.ok) throw new Error('List request failed');
      return res.json();
    })
    .then((data: { data?: ListOption[] } | null) => data?.data ?? [])
    .catch((err) => {
      delete lists[key];
      throw err;
    });
  return lists[key];
}

// EPD sends the visitor to its own pages only. Anything else in redirectUrl (a
// non-https scheme, another domain, credentials in the URL) is not followed.
// The parent domain is taken from EPD_API_BASE, so it follows an environment switch.
// Plain http is allowed only for localhost, where a local EPD runs without TLS.
function safeRedirect(url: string): string | null {
  try {
    const target = new URL(url);
    const parent = new URL(EPD_API_BASE).hostname.split('.').slice(-2).join('.');
    const trusted = target.hostname === parent || target.hostname.endsWith(`.${parent}`);
    const local = target.hostname === 'localhost' || target.hostname === '127.0.0.1';
    const secure = target.protocol === 'https:' || (local && target.protocol === 'http:');
    return secure && !target.username && !target.password && trusted
      ? target.href
      : null;
  } catch {
    return null;
  }
}

// A normal signup answers in a few seconds. This only stops a request that
// hangs, and is long enough not to cut off a slow one that would succeed.
const TIMEOUT_MS = 60_000;

const TIMEOUT_MESSAGE = 'This is taking longer than expected. Please try again.';

// field_errors can lead with a property that is not one of the inputs (an
// unrecognized key), so prefer the first error on a real form field.
function readError(data: SignupResponse | null): { message: string; field?: string } {
  const fieldError = data?.error?.field_errors?.find(
    (e) => e.field && FORM_FIELDS.includes(e.field) && e.message
  );
  if (fieldError?.message) return { message: fieldError.message, field: fieldError.field };
  return {
    message:
      data?.error?.message ?? data?.message ?? 'Please check your details and try again.',
  };
}

// 429: EPD's own message, plus how long to wait from the Retry-After header
// (seconds, or an HTTP date). A cross-origin response only exposes that header
// when EPD's CORS allows it; without it the message goes out on its own.
function rateLimitMessage(data: SignupResponse | null, res: Response): string {
  let message =
    data?.error?.message ?? data?.message ?? 'Too many attempts. Please try again later.';

  const header = (res.headers.get('Retry-After') ?? '').trim();
  const seconds = /^\d+$/.test(header)
    ? Number(header)
    : (Date.parse(header) - Date.now()) / 1000;
  if (seconds > 0) {
    const minutes = Math.ceil(seconds / 60);
    if (!/[.!?]$/.test(message)) message += '.';
    message += ` You can try again in ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}.`;
  }
  return message;
}

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === 'string' ? value.trim() : '';
}

// True when the honeypot is too small for a person to see or type into.
function isHidden(el: Element | null | undefined): boolean {
  if (!el) return true;
  const box = el.getBoundingClientRect();
  return box.width < 5 && box.height < 5;
}

// Shrunk to 1px in place, not pushed off-screen: a left offset scrolls
// right-to-left pages sideways.
const honeypotStyle: React.CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  margin: -1,
  padding: 0,
  border: 0,
  overflow: 'hidden',
  clipPath: 'inset(50%)',
  whiteSpace: 'nowrap',
};

export function EpdSignupForm() {
  // Ids unique to this copy, so the form can be rendered more than once on a
  // page (a hero and a footer) with every label pointing at its own input.
  const id = useId();
  const [error, setError] = useState('');
  const [invalidField, setInvalidField] = useState<string | undefined>();
  const [submitting, setSubmitting] = useState(false);
  const [countries, setCountries] = useState<ListOption[]>([]);
  const [industries, setIndustries] = useState<ListOption[]>([]);
  const [industry, setIndustry] = useState('');

  useEffect(() => {
    let active = true;
    Promise.all([loadList('countries'), loadList('industryTypes')])
      .then(([countryList, industryList]) => {
        if (!active) return;
        setCountries(countryList);
        setIndustries(industryList);
      })
      .catch(() => {
        if (active) setError('Could not load the form. Please refresh the page.');
      });
    return () => {
      active = false;
    };
  }, []);

  // Back button after the redirect restores this page from the browser's cache
  // with the button still disabled. Turn it back on.
  useEffect(() => {
    function onPageShow(event: PageTransitionEvent) {
      if (event.persisted) setSubmitting(false);
    }
    window.addEventListener('pageshow', onPageShow);
    return () => window.removeEventListener('pageshow', onPageShow);
  }, []);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setInvalidField(undefined);

    const form = event.currentTarget;

    // iPhone and Mac type a curly apostrophe (O’Brien) by default. The API only
    // accepts a straight one, so swap it before validating.
    for (const name of ['firstName', 'lastName']) {
      const input = form.elements.namedItem(name) as HTMLInputElement;
      input.value = input.value.replace(/[\u2018\u2019\u02BC]/g, "'");
    }

    const formData = new FormData(form);

    // Honeypot tripped. Act like it worked and send nothing. Only when the field
    // is really hidden: a page that blocks inline styles shows it, and a person
    // who fills it in must not be dropped.
    const honeypot = form.elements.namedItem('homepage') as HTMLInputElement | null;
    if (text(formData, 'homepage') && isHidden(honeypot?.parentElement)) return;

    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }

    // Build the body from named fields only. Never spread the whole FormData:
    // hidden inputs the host page already had would leak in as unrecognized
    // keys and the API would reject the request.
    const body: Record<string, string | number | Record<string, string>> = {
      firstName: text(formData, 'firstName'),
      lastName: text(formData, 'lastName'),
      companyName: text(formData, 'companyName'),
      email: text(formData, 'email'),
      country: Number(text(formData, 'country')),
      industry: Number(text(formData, 'industry')),
      estimatedYearlySales: Number(text(formData, 'estimatedYearlySales')),
      website: text(formData, 'website'),
      cardPaymentMethod: text(formData, 'cardPaymentMethod'),
    };
    if (text(formData, 'industry') === INDUSTRY_OTHER) {
      body.industryOther = text(formData, 'industryOther');
    }

    if (PARTNER_KEY.trim()) body.partnerKey = PARTNER_KEY.trim();

    // UTM and ad click-ID attribution. Read-only: never written back to the URL or history,
    // never a form field. Each value is sent only when the page URL carries it.
    // No defaults: a param the URL does not carry is not sent.
    const params = new URLSearchParams(window.location.search);
    const utm = (param: string) => (params.get(param) ?? '').trim().slice(0, 100);
    for (const [bodyKey, param] of [
      ['utmSource', 'utm_source'],
      ['utmMedium', 'utm_medium'],
      ['utmCampaign', 'utm_campaign'],
      ['utmTerm', 'utm_term'],
      ['utmContent', 'utm_content'],
    ] as const) {
      const value = utm(param);
      if (value) body[bodyKey] = value;
    }

    // Ad click IDs go inside utmParams, keyed as they appear in the URL. The API
    // has no top-level field for them and rejects unrecognized properties (400).
    const utmParams: Record<string, string> = {};
    for (const param of ['gclid', 'gbraid', 'wbraid', 'fbclid']) {
      const value = utm(param);
      if (value) utmParams[param] = value;
    }
    if (Object.keys(utmParams).length > 0) body.utmParams = utmParams;

    setSubmitting(true);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      clearTimeout(timer);

      const data = (await res.json().catch(() => null)) as SignupResponse | null;

      if (res.status === 429) {
        setError(rateLimitMessage(data, res));
        setSubmitting(false);
        return;
      }

      if (!res.ok) {
        const apiError = readError(data);
        setError(apiError.message);
        setInvalidField(apiError.field);
        if (apiError.field) {
          (form.elements.namedItem(apiError.field) as HTMLInputElement | null)?.focus();
        }
        setSubmitting(false);
        return;
      }

      if (!data?.redirectUrl) {
        setError('Something went wrong. Please try again.');
        setSubmitting(false);
        return;
      }

      const target = safeRedirect(data.redirectUrl);
      if (!target) {
        setError('Something went wrong. Please try again.');
        setSubmitting(false);
        return;
      }

      // Works for both branches: a new lead goes to EPD's signup page with these
      // answers filled in, an existing account goes to login. Do not tell the visitor which one happened
      // (data.alreadyRegistered): that would reveal whether an email has an account.
      window.location.href = target;
      // submitting stays true on purpose while the browser navigates away.
    } catch {
      clearTimeout(timer);
      setError(
        controller.signal.aborted ? TIMEOUT_MESSAGE : 'Something went wrong. Please try again.'
      );
      setSubmitting(false);
    }
  }

  return (
    // method="post" keeps visitor details out of the URL if someone submits
    // before the page's JavaScript has loaded.
    <form onSubmit={handleSubmit} method="post" noValidate aria-busy={submitting || undefined}>
      <div>
        <label htmlFor={`${id}-first-name`}>First name</label>
        <input
          id={`${id}-first-name`}
          name="firstName"
          type="text"
          autoComplete="given-name"
          required
          minLength={2}
          maxLength={20}
          aria-invalid={invalidField === 'firstName' || undefined}
        />
      </div>

      <div>
        <label htmlFor={`${id}-last-name`}>Last name</label>
        <input
          id={`${id}-last-name`}
          name="lastName"
          type="text"
          autoComplete="family-name"
          required
          minLength={2}
          maxLength={20}
          aria-invalid={invalidField === 'lastName' || undefined}
        />
      </div>

      <div>
        <label htmlFor={`${id}-company`}>Company name</label>
        <input
          id={`${id}-company`}
          name="companyName"
          type="text"
          autoComplete="organization"
          required
          minLength={3}
          maxLength={150}
          aria-invalid={invalidField === 'companyName' || undefined}
        />
      </div>

      <div>
        <label htmlFor={`${id}-email`}>Email</label>
        <input
          id={`${id}-email`}
          name="email"
          type="email"
          autoComplete="email"
          required
          aria-invalid={invalidField === 'email' || undefined}
        />
      </div>

      {/* Options are loaded from EPD when the form mounts. */}
      <div>
        <label htmlFor={`${id}-country`}>Country</label>
        <select
          id={`${id}-country`}
          name="country"
          required
          defaultValue=""
          aria-invalid={invalidField === 'country' || undefined}
        >
          <option value="">Select...</option>
          {countries.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor={`${id}-industry`}>Industry</label>
        <select
          id={`${id}-industry`}
          name="industry"
          required
          value={industry}
          onChange={(event) => setIndustry(event.target.value)}
          aria-invalid={invalidField === 'industry' || undefined}
        >
          <option value="">Select...</option>
          {industries.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name}
            </option>
          ))}
        </select>
      </div>

      {/* Asked, and sent, only for the "Other" industry. */}
      {industry === INDUSTRY_OTHER && (
        <div>
          <label htmlFor={`${id}-industry-other`}>Specify your industry</label>
          <input
            id={`${id}-industry-other`}
            name="industryOther"
            type="text"
            required
            maxLength={255}
            aria-invalid={invalidField === 'industryOther' || undefined}
          />
        </div>
      )}

      <div>
        <label htmlFor={`${id}-yearly-sales`}>Estimated yearly sales (USD)</label>
        <input
          id={`${id}-yearly-sales`}
          name="estimatedYearlySales"
          type="number"
          inputMode="decimal"
          min={1}
          step="any"
          required
          aria-invalid={invalidField === 'estimatedYearlySales' || undefined}
        />
      </div>

      <div>
        <label htmlFor={`${id}-website`}>Company website</label>
        <input
          id={`${id}-website`}
          name="website"
          type="text"
          inputMode="url"
          autoComplete="url"
          placeholder="example.com"
          required
          aria-invalid={invalidField === 'website' || undefined}
        />
      </div>

      <div>
        <label htmlFor={`${id}-card-payments`}>How are you currently accepting card payments?</label>
        <select
          id={`${id}-card-payments`}
          name="cardPaymentMethod"
          required
          defaultValue=""
          aria-invalid={invalidField === 'cardPaymentMethod' || undefined}
        >
          <option value="">Select...</option>
          {CARD_PAYMENT_METHODS.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>

      {/* Honeypot. Hidden from people, filled by bots. Do not remove. */}
      <div aria-hidden="true" style={honeypotStyle}>
        <label htmlFor={`${id}-homepage`}>Homepage</label>
        <input id={`${id}-homepage`} name="homepage" type="text" tabIndex={-1} autoComplete="off" />
      </div>

      <button type="submit" disabled={submitting}>
        {submitting ? 'Please wait...' : 'Next'}
      </button>

      <p role="alert" style={{ color: '#c00', minHeight: '1.25rem' }}>
        {error}
      </p>
    </form>
  );
}
