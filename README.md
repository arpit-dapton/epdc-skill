# EPD Commerce

This skill is for partners who want to earn commission by referring merchants to Easy Pay Direct. Give it to your AI coding assistant and it builds a merchant signup form (first name, last name, company, email) for a page you control - a blog, partner landing page, or marketing microsite - that you embed in whichever of three ways fits your site (full form, redirect handoff, or email-based signup). Every merchant who signs up through your form is attributed to you via your partner key, so the signups you drive earn you a monthly residual commission for the lifetime of their account.

## Installation

**What you'll need**

- **A partner API key (optional)**, from the [EasyPayDirect partner portal](https://emap.epd.dev/signup/partner).
  It's what attributes signups to you for commission.
- **An AI coding assistant** (Claude Code, Cursor, OpenAI Codex, etc.). This is what
  actually builds the form from the skill. App builders like v0 or Replit work too,
  as long as you can give them the `SKILL.md` contents to build from.
- **Node.js**, only for the `npx` install method below; not needed if you copy the
  skill manually. Get it at [nodejs.org](https://nodejs.org).

**1. Get the skill**

*Option A: `npx skills` (recommended)*

> **Before you run this, you need Node.js installed.** It's what provides the `npx`
> command. Download it from [nodejs.org](https://nodejs.org) (pick the "LTS" version
> and click through the installer), then reopen your terminal. To check it worked,
> run `node --version`; if it prints a version number you're set. If `npx` still
> isn't found after installing, close and reopen the terminal.

```bash
npx skills add arpit-dapton/epdc-skill
```

*Option B: download it (no terminal needed)*

1. Click the green **Code** button -> **Download ZIP**, then unzip it.
2. The skill is the `skills/epd-external-signup` folder inside. Point your agent at
   it (next step), or drop that folder wherever your agent reads skills from.

**2. Point your agent at it**

First, open your AI assistant in the right folder: go to the folder where the skill was
installed, or, if you downloaded it manually, the unzipped folder. The paths in the
examples below are relative to it, so the assistant needs to be started from there to
find `SKILL.md`.

Then tell your AI assistant to build the form from `SKILL.md`. A few examples:

*Claude:*
```
Build the signup form using this specification: skills/epd-external-signup/SKILL.md
```

*OpenAI Codex:*
```
Build the signup form using this specification: skills/epd-external-signup/SKILL.md
```

*Any other agent:*
```
Generate the signup form described in skills/epd-external-signup/SKILL.md.
```

It asks one question first - whether you're registered as an Easy Pay Direct
partner - then copies a template into your project, already pointed at EPD's
backend.

## The Partner Key

A partner key credits you for every signup the form sends.
It is optional. The skill asks about it first, and there are three ways to answer:

| You are | What happens |
| --- | --- |
| A registered Easy Pay Direct partner | Paste your key and it goes into the form. To find it: log in at https://emap.epd.dev → **Integration** → **API Integration** (https://emap.epd.dev/dashboard/partner/integration) → copy the value next to **Partner key** at the top of the page (use the **Copy** button). Not the "API Key - Authorization" value on the API Documentation page: that is your secret API key |
| Not registered | You get a link to register at https://emap.epd.dev/signup/partner - but the build does not wait for you |
| Not interested | Skip it. The form works exactly the same, no commission is credited |

Skipping is safe. You can add a key to a finished form later by setting
`PARTNER_KEY` in it; see
[`references/partner-key.md`](skills/epd-external-signup/references/partner-key.md#adding-a-key-later).
Signups sent before that aren't credited.

The key works the same on every kind of site (WordPress, Webflow, plain HTML,
React, Next.js). It isn't a secret, so it sits in the form itself.

## Folder Structure

```
skills/epd-external-signup/
├── SKILL.md                     entry point - decisions and routing only
├── references/                  the agent reads these on demand
│   ├── api.md                   request/response contract, validation, rate limits
│   ├── partner-key.md           partner key wiring
│   └── troubleshooting.md       symptom -> cause -> fix
├── assets/                      the agent copies these; it does not retype them
│   ├── form.html                plain HTML + vanilla JS, no build step
│   ├── form.tsx                 React / Next.js client component
│   └── route.ts                 optional Next.js route handler, to submit via your server
└── scripts/
    └── verify.mjs               checks a generated file before you ship it
```

The split is deliberate. `SKILL.md` holds only what the agent needs to *decide* what
to do, so it stays cheap to load. `references/` holds detail pulled in on demand.
`assets/` holds complete working files that get **copied**, not regenerated from a
code block in a prompt - which is what keeps the generated form byte-correct
regardless of which model is driving.

## Current Skills

| Skill | Entry point |
| --- | --- |
| EPD External Signup | [`skills/epd-external-signup/SKILL.md`](skills/epd-external-signup/SKILL.md) |
