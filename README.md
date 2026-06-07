# Store Replenishment Miniapp

Telegram miniapp prototype for store replenishment by label scan.

The app helps a hall worker scan a product label, mark sizes already present in the hall, and create a warehouse picking list for missing sizes.

## Current Stack

- Next.js 16 App Router
- React 19
- Prisma 6
- SQLite
- Tesseract.js client-side OCR
- Tailwind CSS 4

## Product Summary

The hall worker scans the 17-digit code above the barcode. The code is parsed as:

```text
article color skip season storage
4829101 123 45 6 7890
```

The required hall size set is:

```text
XS S M L XL
```

`Suggested sizes` are the missing sizes from that fixed set.

## Documentation

Start here:

- [doc/PRODUCT_CONTEXT.md](./doc/PRODUCT_CONTEXT.md)
- [doc/DEVELOPMENT_PLAN.md](./doc/DEVELOPMENT_PLAN.md)
- [doc/AGENT_NOTES.md](./doc/AGENT_NOTES.md)
- [doc/CHANGELOG.md](./doc/CHANGELOG.md)
- [doc/GITHUB_PUBLISHING.md](./doc/GITHUB_PUBLISHING.md)

Future developers and AI agents should read these before changing code.

## Local Setup

```bash
npm install
cp .env.example .env
npm run prisma:generate
npx prisma migrate deploy
npm run db:seed
```

Run development server:

```bash
npm run dev
```

Run production build locally:

```bash
npm run build
npm run start -- -p 3010
```

Open on Mac:

```text
http://localhost:3010
```

Open on phone from the same Wi-Fi network using the `Network` URL shown by Next.js, for example:

```text
http://192.168.1.106:3010
```

## Important Files

- `app/page.tsx` - main Hall/Warehouse UI.
- `lib/label-extractor.ts` - label OCR text parser.
- `lib/replenishment.ts` - hall size replenishment rules.
- `app/api/label/extract/route.ts` - label extraction API.
- `app/api/scan/route.ts` - creates request items and computes suggested sizes.
- `app/api/requests/[id]/warehouse/route.ts` - warehouse grouped list.
- `prisma/schema.prisma` - Prisma data model.
- `prisma/seed.ts` - local seed data.

## Checks

```bash
npm run build
```

Before publishing to GitHub:

```bash
git status --short
```

Make sure `.env`, local SQLite databases, `.next`, and `node_modules` are not staged.
