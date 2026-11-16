# NextJS Treasury Clearing Hub

A multi-tenant B2B treasury clearing, cross-currency FX conversion, tiered commission & tax withholding (GST/TDS), rolling-reserve clawback, and double-entry settlement engine built on **Next.js 16 (App Router)** and **TypeScript**.

Designed around strict minor-unit integer accounting (`paisa` / `cents`), deterministic idempotency replay protection, and automated ledger reconciliation against external gateway settlement statements.

---

## Core Architecture & Module Map

The codebase is organized into isolated domain engines under `src/lib/` backed by Next.js App Router API endpoints under `src/app/api/`:

```text
src/
├── app/
│   └── api/
│       ├── health/route.ts                         # Service liveness & active tenant count
│       └── tenants/[tenantId]/
│           ├── entries/route.ts                    # Signed clearing entry ingestion & listing
│           ├── settlements/route.ts                # Batch payout aggregation & disbursement
│           ├── disputes/route.ts                   # Chargeback lifecycle (OPEN / RESOLVE)
│           ├── splits/route.ts                     # Multi-vendor marketplace split payouts
│           ├── reconcile/route.ts                  # Double-entry & gateway statement matcher
│           └── ledger/route.ts                     # Liquidity exposure, aging & journal lines
└── lib/
    ├── audit/compliance-redactor.ts                # Audit trail builder & email/PAN/bank masking
    ├── clearing/
    │   ├── clearing-ingestion.service.ts           # End-to-end validation, FX, tax & journal posting
    │   └── clearing-state-machine.ts               # Deterministic entry lifecycle state transitions
    ├── disputes/chargeback-clawback.ts             # Dispute holds & rolling-reserve vault clawbacks
    ├── errors/clearing-error.ts                    # Typed HTTP/domain error codes & status mapping
    ├── fx/fx-rate-engine.ts                        # Multi-currency quotes (INR/USD/EUR/GBP) & spread
    ├── idempotency/replay-guard.ts                 # Idempotency key normalization & payload hashing
    ├── math/minor-unit-ledger.ts                   # Double-entry journal verification & rounding
    ├── merchants/tier-policy.ts                    # Tenant profiles, volume tiers & reserve vaults
    ├── reconciliation/statement-matcher.ts         # Ledger balance & gateway statement reconciliation
    ├── security/hmac-verifier.ts                   # HMAC-SHA256 request signature verification
    ├── settlements/settlement-batcher.ts           # Net payout batching & reserve accounting
    ├── splits/multi-vendor-splitter.ts             # Basis-point + fixed fee vendor split planner
    ├── store/
    │   ├── engine-singleton.ts                     # Dependency container for API route handlers
    │   └── journal-store.ts                        # Atomic JSON journal persistence (data/)
    ├── treasury/
    │   ├── fee-rebate-engine.ts                    # Monthly volume tier evaluation & fee rebates
    │   └── liquidity-forecast.service.ts           # Aging exposure buckets & reserve release checks
    └── webhooks/outbound-dispatcher.ts             # Signed outbound webhook envelopes & backoff



This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
