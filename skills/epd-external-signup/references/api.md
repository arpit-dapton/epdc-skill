# EPD External Signup API contract

Base URL: `https://api-dev.dev1.epd.com` (dev)

No auth header. No API key. This endpoint is anonymous by design: it exists to
create a merchant that does not have a key yet.

## The flow

```
Your page                      EPD backend                    EPD /auth page
---------                      -----------                    --------------
[first/last/company/email]
     |  Next >
     |  POST /v1/external-signup
     +---------------------------->
                                 validates the 4 fields
                                 if email already has an account
                                   -> returns a login URL, no OTP
                                 else
                                   -> emails a 6-digit OTP
                                   -> saves the lead server-side
                                   -> returns a redirect URL
                                      carrying only the email
     <----------------------------+
     |  { alreadyRegistered, redirectUrl }
     |
     |  send the browser to redirectUrl
     +------------------------------------------------------------>
                                                          reads email from URL
                                                          jumps to the OTP step
                                                          fetches name/company to
                                                            prefill the next step
                                                          user enters OTP, sets a
                                                            password
                                                          account created, logged in
```

Your only job: render the form, POST it, send the browser to `redirectUrl` (after
checking it is an https URL on EPD's own domain, as the templates do; plain http
is accepted only for `localhost`, for local testing).
EPD's `/auth` page owns everything after the redirect, including the prefill
lookup. You never call the prefill endpoint yourself.

## POST /v1/external-signup

Rate limited to **60 requests per hour per IP** and **5 requests per hour per
email from the same IP**. Over either returns `429`.

### Request body (JSON)

| Field | Required | Rules |
| --- | --- | --- |
| `email` | yes | valid email address |
| `firstName` | yes | 2-20 chars, letters, spaces, periods, hyphens, straight apostrophes (`'`, not `’`), no HTML. The templates convert curly apostrophes before sending |
| `lastName` | yes | 2-20 chars, same character set as `firstName`, no HTML |
| `companyName` | yes | 3-150 chars, no HTML |
| `partnerKey` | no | string, max 100 chars, no HTML. See `partner-key.md` |
| `utmSource` | no | string, max 100 chars, no HTML |
| `utmMedium` | no | string, max 100 chars, no HTML |
| `utmCampaign` | no | string, max 100 chars, no HTML |
| `utmTerm` | no | string, max 100 chars, no HTML |
| `utmContent` | no | string, max 100 chars, no HTML |
| `utmParams` | no | object of string values (max 20 keys, 100 chars per value, no HTML), keyed as in the URL. Where ad click IDs go: `gclid`, `gbraid`, `wbraid` (Google Ads), `fbclid` (Meta). Example: `{ "gclid": "Cj0KCQ" }` |

There are **no top-level `gclid`, `gbraid`, `wbraid` or `fbclid` fields**. Sending
one at the top level is an unrecognized property and the whole request returns 400.
Click IDs go inside `utmParams`, and only when the URL carries them.

The API rejects any property it does not recognize. Build the request body from
named fields. Never spread a whole `FormData` into it: a hidden input the host
page already had (its own `name="utm_campaign"` analytics field, for example)
would leak in as an unrecognized snake_case key and the request would 400.

Name and company rules mirror EPD's own signup form, so a value accepted here
also passes final account creation. No surprise rejection later.

### Known gaps in these rules

These are the server's rules. The form cannot work around them:

- **Names accept Western European letters only.** The server allows `A-Z`,
  `a-z`, and the accented letters `À`-`ÿ` (José, Zoë, Müller), plus spaces,
  periods, hyphens, and straight apostrophes. Anything else is rejected:
  `Łukasz`, `Dvořák`, `Nguyễn`, non-Latin scripts, and an accent stored as a
  separate combining mark. The templates have no browser `pattern` check, so these
  names reach the server and come back as a 400 with the server's message ("First
  name can only contain letters, spaces, periods, hyphens, and apostrophes."),
  which the form shows on the field.
- **`companyName` minimum of 3 rejects real companies.** "3M" and "BP" are two
  characters.

### Response - new lead

```json
{
  "alreadyRegistered": false,
  "redirectUrl": "https://app.epd.example/auth?externalSignup=1&email=ada%40example.com"
}
```

An OTP email is sent. Redirect the browser to `redirectUrl`.

### Response - email already has an account

```json
{
  "alreadyRegistered": true,
  "redirectUrl": "https://app.epd.example/auth?login=1&email=ada%40example.com"
}
```

No OTP is sent. Redirect the browser to `redirectUrl` and it lands on the login
screen with the email filled in. Do not show a message saying the account exists:
it reveals which emails are registered. Just redirect.

> The `redirectUrl` values above are illustrative. The real host differs per
> environment. Never build this URL yourself. Always use the value returned.

### Success status code

`201` for both branches, including `alreadyRegistered: true`, where nothing new
is created. Every template branches on `res.ok`, never on an exact status code.

### Response 400 - validation failed

Every error response, whatever its status, is wrapped in a top-level `error` object:

```json
{
  "error": {
    "type": "invalid_request_error",
    "code": "validation_error",
    "message": "Validation failed for 2 fields. First name must be at least 2 characters.",
    "param": "firstName",
    "field_errors": [
      { "field": "firstName", "code": "invalid_value", "message": "First name must be at least 2 characters." },
      { "field": "email", "code": "invalid_value", "message": "Email must be an email." }
    ]
  }
}
```

Read `error.field_errors[]`, each with a single `message` string. There is no
top-level `field_errors` and no `messages` array.

- `field_errors` lists **every** failing property, not only the first one, and an
  unrecognized property (`"Property bogus should not exist."`) can come first.
  Show the first error whose `field` is one of the four inputs, and mark that input.
- `error.message` summarises all of them ("Validation failed for N fields. ...").
  Use it only when no error names a form field.
- `field_errors` is absent on non-validation errors. Fall back to `error.message`,
  then a generic message.

The templates do exactly this in `readError`.

### Response 429 - rate limited

Same `error` envelope, no `field_errors`. Two limits can trigger it:

| Limit | `error.message` | `Retry-After` header |
| --- | --- | --- |
| 60 per hour per IP | `ThrottlerException: Too Many Requests` | yes, in seconds |
| 5 per hour per email, from the same IP | `Too many signup attempts for this email. Please try again in N minutes.` | yes, in seconds |

The templates show `error.message` and, when `Retry-After` is readable, add
"You can try again in N minutes." (seconds rounded up to whole minutes; an HTTP
date also works).

`Retry-After` is not a CORS-safelisted header. A browser calling EPD directly can
only read it if EPD's CORS sends `Access-Control-Expose-Headers: Retry-After`.
Until it does, `form.html` and `form.tsx` show the message without the wait time.
`route.ts` reads the header server-side and passes it on, so a form posting
through it always gets it.

See `troubleshooting.md` for what the IP limit means when you call from a server.

### Response 5xx

Show a generic retry message. Do not retry automatically: the request may have
already created the lead and sent an OTP.

## Client-side or server-side

EPD's CORS reflects the calling origin, so a browser `fetch` works with no backend
change.

| | Client-side | Server-side |
| --- | --- | --- |
| Setup | just paste the form | needs a route handler |
| Rate limit applies to | each visitor's IP | **your server's single IP** |
| Partner key | in the form's `PARTNER_KEY` | in the form's `PARTNER_KEY`, forwarded |
| `Retry-After` on 429 | only if EPD exposes it via CORS | always |
| Bot filtering | honeypot only | anything you want |

Client-side is the default. The partner key is not a secret, so it does not need a
server. See `partner-key.md`.

The 60/hr per-IP limit is the trap in the server-side path: every visitor shares
your server's IP, so the whole site stops at 60 signups an hour. `assets/route.ts`
forwards the visitor's IP in `X-Forwarded-For`, but do not rely on it: any caller
can set that header, so EPD is expected to stop trusting it from outside its own
proxies. Add your own per-visitor throttle to the route, and ask the backend team
to raise the limit for your server's IP if you expect more than 60 signups an hour.

## Notes

- **The lead is saved immediately, but only counts once signup completes.** EPD
  saves email, name, company, partner key, and UTM values as soon as the POST
  succeeds. That is why the redirect URL only carries the email. The lead is only
  passed on for partner credit after the visitor enters the OTP and sets a
  password. A visitor who stops at the OTP step credits nobody.
- **Account creation is gated by the OTP and the password**, not by anything in
  the redirect URL. There is nothing in that URL to tamper with.
- **The email travels in the query string** of the redirect URL, so it lands in
  browser history and referrer headers. Acceptable for a first-touch flow, but
  worth knowing.
- **This endpoint reveals whether an email has an EPD account.** `alreadyRegistered`
  is returned to an anonymous caller, so it can be probed at 60 attempts an hour
  per IP. Raise this with the backend team if account enumeration matters to you.
  The templates never show the visitor which branch happened, and neither should
  you: a message like "you already have an account" tells anyone which emails are
  registered.
