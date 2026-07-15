# Poker Night

A private, play-money Texas Hold'em poker table built with Next.js + PartyKit.

## Requirements

- Node.js 20.19+
- npm
- GitHub repository access
- PartyKit CLI (`npx partykit` works via npm)

## Local development

```bash
npm install
cp .env.example .env
npm run dev
```

Open:

- `http://localhost:3000`
- Enter a nickname and create a table, then join from a second browser with the room code.

## Environment variables

Create `.env` from `.env.example`.

- `NEXT_PUBLIC_PARTYKIT_HOST`
  - Local: `localhost:1999`
  - Production: your deployed PartyKit host, for example `<your-partykit>.partykit.dev`
- `NEXT_PUBLIC_PARTY_NAME` is optional and defaults to `main`.

## GitHub + Push

```bash
git init
git add .
git commit -m "Initial poker app import"
git branch -M main
git remote add origin https://github.com/samuelharting/poker.git
git push -u origin main
```

If the repository already exists, just use `git add`, `git commit`, and `git push`.

## Deploy PartyKit Server

```bash
npm run deploy:partykit
```

After deploy, copy the deployed host, for example `<name>.partykit.dev`, and put it in the Vercel environment variable:

- `NEXT_PUBLIC_PARTYKIT_HOST` = `<your-partykit-host>`

## Deploy Next.js on Vercel

### With Vercel Plugin

1. Connect repo `samuelharting/poker`.
2. Add build command: `npm run build`.
3. Add environment variables:
   - `NEXT_PUBLIC_PARTYKIT_HOST` = your deployed PartyKit host
   - `NEXT_PUBLIC_PARTY_NAME` = `main` (optional)
4. Deploy.

### With Vercel CLI

```bash
npm run deploy:vercel
```

## Smoke Checks Before Sharing

- `npm run check`
- With the app and PartyKit running, `npm run smoke:e2e`
- Host creates a room, invite a friend with a second account/browser
- Start hand, ensure real-time updates, fold/check/call/raise and reveal flow work
- Verify table settings changes still sync across players

## Production-Readiness Notes

- This is built for private play-money rooms. It is not a regulated gambling platform and does not process wagers.
- Room codes are generated with browser crypto using six uppercase, non-ambiguous characters. Legacy numeric room codes still join for older links.
- Run `npm run audit:prod` before deploy. It fails on high/critical production advisories while tolerating the current moderate Next nested PostCSS audit warning tracked upstream.
- Dev-only PartyKit/Miniflare advisories are still visible in a full `npm audit`; they are not production runtime dependencies for the Next.js site, but should be revisited when PartyKit publishes patched transitive dependencies.
