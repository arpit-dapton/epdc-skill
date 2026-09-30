# Troubleshooting

## The form submits and nothing happens

Check the browser console and network tab first.

| Symptom | Cause | Fix |
| --- | --- | --- |
| No network request at all | The submit handler never ran, or a validation attribute is blocking | Confirm the `<form>` still has `data-epd-signup` and the script is on the page. Check for a JS error earlier on the page |
| Page reloads, nothing is created | The script was stripped (some site builders remove `<script>`), so the browser submitted the form itself | Put the form in a block that allows scripts, e.g. WordPress **Custom HTML** as an Administrator. `method="post"` keeps the details out of the URL meanwhile |
| Clicking Next does nothing, console shows `Cannot set properties of null` | An older `form.html` that needed `type="submit"` on the button and `role="alert"` on the message, restyled without them | Recopy the template from `assets/` |
| No network request, and the script sits above the form | An older `form.html` that looked for the form before the page finished loading | Recopy the template from `assets/` |
| Visitor's name and email appear in the address bar | An older template without `method="post"`, whose script did not run | Recopy the template from `assets/` |
| Button stays disabled after pressing Back | An older template without the `pageshow` handler | Recopy the template from `assets/` |
| Button shows "Please wait..." for a minute, then "This is taking longer than expected..." | EPD did not answer within 60 seconds. The signup may still have gone through, which is why the message points to the inbox | Nothing to fix in the form. If it keeps happening, report it to the backend team |
| Request fires, page does not move | `redirectUrl` missing from the response | The templates guard against this and show an error. Check the response body |
| Navigates to `undefined` | An older template without the `redirectUrl` guard | Recopy the template from `assets/` |

## 400 on every submit

| Cause | Fix |
| --- | --- |
| An extra property in the body | The API whitelists properties. Build the body from named fields, never spread a whole `FormData`. If the host page's form has its own hidden inputs, a spread leaks them in |
| Field names were renamed | They must be exactly `firstName`, `lastName`, `companyName`, `email` |
| A value is empty or whitespace | The templates trim before sending. If you edited that out, `"  "` passes the browser's `minlength` and fails server-side |
| A click ID (`gclid`, `gbraid`, `wbraid`, `fbclid`) sent as a top-level field | The API has no such field and returns 400 for the whole request, so any ad-click visitor fails. Click IDs go inside `utmParams`: `{ "gclid": "..." }` |
| A `utm*` or click-ID (`gclid`, `gbraid`, `wbraid`, `fbclid`) value over 100 chars | The templates truncate to 100. Do not remove that |
| A name with a letter outside Western European Latin (`Ł`, `ř`, `ễ`, non-Latin scripts) | The server only accepts `A-Z`, `a-z`, and `À`-`ÿ`. The form shows its "can only contain letters..." message on the field. Nothing to fix in the form. See "Known gaps" in `api.md` |
| Company name under 3 chars | `companyName` has a 3-character minimum. "3M" is rejected. Known gap, see `api.md` |

Read the actual message from the response body rather than guessing: look in
`error.field_errors[]` for the entry whose `field` is one of the four inputs and
read its `message`. `error.message` summarises every failure. See "Response 400"
in `api.md`.

If the form only ever shows "Please check your details and try again." for
rejected input, it was generated from an older template that read
`field_errors[0].messages[0]`, which EPD never returns. Recopy it from `assets/`.

## 429 message has no wait time

The form adds "You can try again in N minutes." only when it can read the
`Retry-After` header:

- **Form posts straight to EPD:** the browser hides `Retry-After` unless EPD's CORS
  sends `Access-Control-Expose-Headers: Retry-After`. Ask the backend team to add it.
- **Posting through `route.ts`:** an older `route.ts` did not pass the header on.
  Recopy it from `assets/`.

## 429 after very few signups

Expected if you are calling from a server. The limit is 60 requests per hour per
IP, and every visitor shares your server's IP, so the whole site stops at 60 an
hour.

`assets/route.ts` forwards the visitor's IP in `X-Forwarded-For`, but do not rely
on it: any caller can set that header, so EPD is expected to stop trusting it from
outside its own proxies. Add your own per-visitor throttle to the route and ask the
backend team to raise the limit for your server's IP.

Client-side templates do not have this problem. The limit applies per visitor,
which is usually what you want. Note that visitors behind corporate NAT or a
mobile carrier share an IP and can exhaust it for each other.

## CORS error in the console

EPD reflects the calling origin, so this should not happen. If it does:

- The `Content-Type: application/json` header makes this a preflighted request.
  Confirm the backend answers `OPTIONS /v1/external-signup`.
- Check you are calling the right host. A typo in `EPD_API_BASE` produces a CORS
  error rather than a 404, because the failure happens before the response.
- If it persists, switch to `assets/route.ts`. A server-to-server call has no CORS.

## Redirected to EPD but the name and company are blank

EPD's `/auth` page fetches those itself after the redirect. You do not pass them.
If they are blank, the lead was not saved, or the prefill lookup failed on EPD's
side. Report it to the backend team with the email address used.

## OTP email never arrives

- Check whether the response had `alreadyRegistered: true`. That branch sends no
  OTP by design and redirects to login instead. (Do not tell the visitor this:
  it reveals which emails have accounts.)
- Otherwise it is an EPD-side delivery issue. The POST succeeding means the lead
  was saved.

## Signups are not credited to the partner

- `PARTNER_KEY` is still `''`, or holds a label ("Partner key: ...") instead of
  the bare key. Run `scripts/verify.mjs`.
- `PARTNER_KEY` holds the secret API key (the "API Key - Authorization" value from
  API Documentation) instead of the partner key. Replace it with the **Partner key**
  from the top of **Integration** → **API Integration**, and treat the exposed API
  key as leaked: it was in page source.
- The key is read from an environment variable that is not set, or not exposed to
  the browser. Put the key in `PARTNER_KEY` as a string.
- The key was typed with a mistake. The form does not report it: the signup still
  succeeds, but nobody is credited. Copy it from the portal again.
- The visitor stopped at the OTP step. A signup is only credited once the visitor
  enters the OTP and sets a password.

## Everything works in dev, nothing works in production

`EPD_API_BASE` still points at `https://api-dev.dev1.epd.com`. That is the
default in every template. Change that one constant.
