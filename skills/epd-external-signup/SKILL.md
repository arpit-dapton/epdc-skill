---
name: epd-external-signup
description: Generate a first-touch signup form (first name, last name, company, email) for an external site that posts to EPD's public signup API and redirects the visitor to EPD to finish with email OTP and password. Use when someone asks for an EPD signup form, EPD lead capture, a partner referral signup page, or wants to collect signups for EPD on their own domain.
license: MIT
---

# EPD External Signup

Generates a signup form that lives on the user's own domain. The form creates a lead
in EPD, then sends the visitor to EPD to finish account creation with email OTP and
a password.

Use this when the user wants a signup form on **their** site, not an embed of EPD's.

Do not use this for authenticated merchant API calls. Those need an API key and go
to other `/v1/*` endpoints. This endpoint is anonymous on purpose: the merchant does
not exist yet, so there is no key to send.

These instructions work in any coding agent (Claude, OpenAI Codex or ChatGPT, v0,
Replit Agent, Cursor, and others). Where a step depends on what your environment
can do, it says so.

## Steps

1. Ask the partner key question (Step 1).
2. Pick a template (Step 2).
3. Put that template in the user's project verbatim. Do not retype it from memory.
4. Change only the things listed in Step 3.
5. Tell the user the base URL points at dev.

## Step 1 - Partner key

This is the first thing you ask. Ask it before generating anything, and ask it
even if the user did not mention partners.

> Are you registered as a partner with Easy Pay Direct?
>
> A partner key credits you for every signup this form sends.
>
> - **Yes** - paste your partner key.
> - **No** - you can register at https://emap.epd.dev/signup/partner.
> - **Skip** - I'll build the form without one. Everything works, and you can
>   add a key later.
>
> **Where to find your key:** log in to the partner portal at https://emap.epd.dev
> → **Integration** → **API Integration** → click **API Documentation**. Your key
> is shown as **API Key - Authorization: `<your key>`**. Copy just the key value
> and paste it here.

If your environment cannot pause to ask a question, treat the answer as **Skip**
and say so in your final message.

Then act on the answer:

| Answer | Do this |
| --- | --- |
| Pastes a key | Put it in `PARTNER_KEY` in whichever template Step 2 picks (Step 3). Use only the key value, never the "API Key - Authorization:" label. Confirm it is set |
| Registered, key not to hand | Give them the steps: log in at https://emap.epd.dev → **Integration** → **API Integration** → **API Documentation** → copy the value shown after **API Key - Authorization:**. Offer to build without it now and add it later |
| Not registered | Give them https://emap.epd.dev/signup/partner, and tell them that once registered the key is under **Integration** → **API Integration** → **API Documentation**. **Do not block on this.** Offer to build without it now and add it later |
| Skip, or no clear answer | Build without it. Change nothing in the template. This is the common case and is completely safe |

Never block the build waiting for a partner key. Registering takes time the user
may not want to spend right now, and the key can be added to a finished form in
one line later: set `PARTNER_KEY`. See `references/partner-key.md`.

Ask this once. If the user already answered it earlier in the conversation, do
not ask again.

The partner key is not a secret. It goes in the form's `PARTNER_KEY` constant as a
plain string, whatever the site is built with. Never read it from an environment
variable (a missing one silently drops the key) and never make it a form field
(the body is built from named fields, so it would not be sent).

After generating, state plainly which happened:

- "Added your partner key `<key>` to the form. Every signup it sends is credited to you."
- "Built without a partner key. To add one later, set `PARTNER_KEY` in the form."

## Step 2 - Pick a template

Check the rows in order. The first match wins.

| Situation | Copy |
| --- | --- |
| React or Next.js | `assets/form.tsx` |
| Plain HTML site, WordPress, Webflow, or any site builder | `assets/form.html` |
| Stack unclear | `assets/form.html` |

A partner key does not change the template. Both forms hold it.

Copy `assets/route.ts` as well **only** when the user asks for signups to go
through their own Next.js (App Router) server. Save it at
`src/app/api/epd-signup/route.ts` if the project has `src/app`, otherwise at
`app/api/epd-signup/route.ts`. Never create a root `app/` in a `src/app` project:
Next.js then ignores `src/app` and the whole site breaks.

For more than one form on a page (a hero and a footer), paste `form.html` once and
repeat only its `<form>` element where the others go. The one script sets up every
copy and gives each its own ids. In React, render `<EpdSignupForm />` as often as
needed.

How to "copy" depends on your environment:

- **You can read the skill's files**: copy the file from `assets/` into the
  user's project.
- **You only have the skill as pasted or attached text**: reproduce the template
  exactly as provided. If the template was not provided, ask the user to paste it
  rather than writing your own.
- **You cannot write to the user's project**: output the file and tell the user
  the path to save it at.

## Step 3 - What to change

Change only these things:

1. `EPD_API_BASE` - leave the default unless the user named an environment.
2. `PARTNER_KEY` - the user's key as a string, when they gave one. Otherwise leave `''`.
3. `ENDPOINT` in `form.tsx` - **only when you also copied `route.ts`**. Set it to
   `'/api/epd-signup'`. Its default posts straight to EPD. Pointing it at
   `/api/epd-signup` without the route makes every submit fail with a 404.
4. Styling - the templates ship unstyled. Match the host page. The site's own
   classes, button, and error element are fine. Keep a submit button inside the
   form: a `<button>` that is not `type="button"`, never a link.

In React, restyle `form.tsx`; do not rebuild it with react-hook-form or the project's
design-system form components unless the user asks for that.

Do not change field names, `minlength`, `maxlength`, the honeypot field, the
form's `method="post"`, or the UTM block. Those match server-side validation and
attribution. Changing them causes 400s or lost attribution.

## Base URL

Default: `https://api-dev.dev1.epd.com`

Use it verbatim. Do not ask the user for it. Do not create or edit `.env` files.
Do not use `process.env` for it. If the user names a different environment,
change the single `EPD_API_BASE` constant and nothing else.

This is a dev endpoint. After generating, tell the user:
"This points at EPD dev. Change EPD_API_BASE before going live."

## UTM attribution

Already handled by every template. Do not ask the user about it.

Each template reads `utm_source`, `utm_medium`, `utm_campaign`, `utm_term`, and
`utm_content` from its own page URL and sends them with the signup, along with the
ad click IDs `gclid`, `gbraid`, `wbraid` (Google Ads) and `fbclid` (Meta). A URL
like `?gclid=123&gbraid=456&wbraid=789&fbclid=009` is picked up as-is. All nine are
treated the same way: sent when the URL carries them, omitted when it does not.

There are no default values. Do not add any. When the page URL carries none of
these parameters, the form sends none.

Never make these form fields. Never write them back to the URL or browser history.

## Checking your work

If you can run Node, run this on each generated file:

```
node <path-to-this-skill>/scripts/verify.mjs <path-to-generated-file>
```

It checks field names, validation attributes, the UTM block, error and rate-limit
handling, and that the partner key is set as a plain string. Fix anything it reports before telling the user you
are done.

`verify.mjs` only understands files built from the templates. If the user asked for
a rebuilt form (react-hook-form, a design-system form), do not change working code
to satisfy it: go through the list below by hand instead.

If you cannot run commands, or the form was rebuilt, check these yourself instead:

- Inputs are named exactly `firstName`, `lastName`, `companyName`, `email`, and each has a label
- The honeypot input `name="website"` is still there
- The request body is built from named fields, never by spreading `FormData` or
  the form library's values, so the honeypot value is never sent
- All five `utm_*` params and the four click IDs (`gclid`, `gbraid`, `wbraid`,
  `fbclid`) are read, each omitted when the URL has no value, with no hardcoded
  fallbacks
- The code checks `redirectUrl` exists before navigating to it
- `form.tsx` points `ENDPOINT` at `/api/epd-signup` only when `route.ts` was copied
- `PARTNER_KEY` is the bare key as a string (or `''`), not an env var or a form field
- The `<form>` keeps `method="post"`
- A 429 shows EPD's message and reads the `Retry-After` header
- `EPD_API_BASE` is a hardcoded `https://` string, not an env var

## More detail

Read these only when you need them:

- Request and response contract, validation rules, error shapes, rate limits ->
  `references/api.md`
- Partner key wiring -> `references/partner-key.md`
- Form submits but nothing happens, CORS errors, 400s -> `references/troubleshooting.md`
