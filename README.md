# Poker Night

A multiplayer Texas Hold’em poker table built with Next.js + PartyKit.

## Requirements

- Node.js 18+
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
  - Production: your deployed PartyKit host (for example `<your-partykit>.partykit.dev`)
- `NEXT_PUBLIC_PARTY_NAME` is optional and defaults to `main`.

## GitHub + push

```bash
git init
git add .
git commit -m "Initial poker app import"
git branch -M main
git remote add origin https://github.com/samuelharting/poker.git
git push -u origin main
```

If the repository already exists, just use `git add`, `git commit`, and `git push`.

## Deploy PartyKit server

```bash
npm run deploy:partykit
```

After deploy, copy the deployed host (for example `<name>.partykit.dev`) and put it in
Vercel environment variable:

- `NEXT_PUBLIC_PARTYKIT_HOST` = `<your-partykit-host>`

## Deploy Next.js on Vercel

### With Vercel plugin
1. Connect repo `samuelharting/poker`.
2. Add build command: `npm run build`.
3. Add environment variable:
   - `NEXT_PUBLIC_PARTYKIT_HOST` = your deployed PartyKit host
   - `NEXT_PUBLIC_PARTY_NAME` = `main` (optional)
4. Deploy.

### With Vercel CLI

```bash
npm run deploy:vercel
```

## Smoke checks before sharing with friends

- `npm test`
- `npm run build`
- Host creates a room, invite a friend with a second account/browser
- Start hand, ensure real-time updates, fold/check/call/raise and reveal flow work
- Verify table settings changes still sync across players
