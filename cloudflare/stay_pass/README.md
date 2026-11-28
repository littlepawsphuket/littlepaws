# Little Paws Stay Pass V1.9

Production release: 28 November 2026. The owner authorized publication. The active initial package is LP-SP-15, 15 days, valid one year, cumulative sales limit 10 across S/M/L; prices are ฿5,100 / ฿6,375 / ฿7,650. Existing overnight, Day Care, monthly rates and previously agreed bookings were not repriced.

## Architecture and rules

Uses the existing staff Worker, Cloudflare Access identity, D1 database, private R2 media, booking/check-in/payment workflows and TH/EN design system. Customer timelines retain their existing token scope. Stay Pass actions are fresh-admin restricted.

- Package and price versions are dynamic. Purchased package/price/policy snapshots are immutable. Unpaid drafts recheck the effective price and terms before full payment; a draft creates no pass, money, credits or sold slot.
- Quarter-day integer units, origin-value credit lots and append-only ledger; carry is consumed first. Reservation holds are separate from actual usage and remain within the remaining obligation. D1 batches, revision checks, stable request keys, constraints and audit protect against duplicate or partial writes.
- Same-family, same-size registered dogs share credits. Overnight is one day per dog; Day Care up to 12 elapsed hours is half a day and over 12 hours is one day, including cross-midnight visits. Over 24 hours needs overnight review.
- Existing pending bookings can be explicitly converted after a fresh review; original agreements, receipts and actual cash remain traceable. Check-in consumes held credits; checkout reconciles actual usage, confirms adjustable whole overnight days and restores unused credits to their original lots.
- Late pickup reuses the existing 24-hour/grace/tier logic and can consume quarter-day credits. Insufficient coverage uses the agreed regular per-dog rate for the cash portion. Partial receipts and outstanding balances are retained; no bank transfer is executed by these recording actions.
- In-house overnight extension calculates incremental credit/cash, preserves the original agreement and records extra partial/full payment without duplicate income.
- Thai calendar cancellation: at least seven days returns all held credits, less notice deducts 50%, no-show 100%, shop cancellation zero. Partial dog cancellation, administrative exceptions, pooled deposits and proportional cash charges preserve prior receipts and immutable fees.
- Change-of-mind refund: purchase date is day one, through day seven at 23:59 Bangkok, no prior service/cancellation/no-show consumption. Refund deadline counts request day as day one of 15. Amounts use original lot values with satang rounding. Purchased credits alone are refundable; carried rights remain until their new expiry.
- Renewal begins on the new purchase date, carries up to three unheld days with original value, consumes carry first, retains old excess until old expiry and counts as another cumulative sale. No returned sale slot after cancellation/refund.
- Expiry, explicit restoration with approved extension, eligible ownership transfer, same-owner pet registration changes and individual image consent all retain audit and immutable purchase history. Open commitments block unsafe lifecycle changes.
- Festival bookings are managed manually by the owner. There is no automatic priority booking lock.

## Images and reporting

Approved portrait Ivory Wallet design; original logo, OFL Noto Sans Thai and Cormorant Garamond, mobile typography, natural height and multi-page content. Card, usage, renewal and full policy guide support TH/EN/bilingual, PNG/JPG, preview widths, download/share, private original HTML/files and immutable historical snapshots. Generation never changes cash or credit. Template settings have preview-bound, immutable versions and minimum readability/contrast safeguards.

Dashboard separates cash, service value, original lot obligation, available/held credits and cumulative sales capacity. Package/date/size/current-status filters select purchase cohorts. Twenty CSV/report views preserve source values and historic purchaser identity. These are management reports, not a tax or accounting recognition policy.

Cloudflare Browser Run can impose quota/rate limits. Image failure is reported clearly; saved images and HTML previews remain available, and no ledger/payment change is made. No paid plan was enabled. Further physical iPhone/Android/iPad and real LINE delivery checks are not claimed complete.

## Release and recovery

Migrations 001–023 are additive. Migration 023 is immutable policy approval evidence, not a festival-lock feature. All 30 legacy tables were restored/rehearsed unchanged, integrity and foreign keys valid. Initial configuration was rehearsed before application and created no customer sale, receipt or credit. A private D1 export and 539 R2 objects (283,669,820 bytes) were verified with SHA-256; all 503 media references in the pre-deploy database were present. Do not upload backups or credentials to GitHub.

Production requires `STAY_PASS_ENVIRONMENT=production`, `STAY_PASS_ENABLED=1` and `STAY_PASS_RELEASE=v1.9`; the preview flag alone cannot enable production. Independent write flags remain required. The hourly expiry schedule rechecks the configured active administrator and pending commitments. Preserve existing Access audience variables.

`cloudflare/build_release.mjs` creates an explicit deployable source copy with original brand bytes read from private, versioned R2 keys instead of embedded bytes. Repository originals remain intact. All 19 brand/font assets in production and staging were verified byte-for-byte. The deployable Worker is about 442 KiB gzip.

Stop new writes by disabling Stay Pass activation/write flags while retaining current readers, exports, history, objects and all tables. Do not restore an older database over later real payments or customer rights. Use audited reversal/adjustment workflows for corrections; dependent historical corrections require individual review. Private backup locations and deployment version IDs are in the local release evidence, not this public repository.

## Verification

`test_release.mjs` runs the composed SQLite suite through full sale, hold, cash split, check-in, cancellation, checkout, refund, renewal, extension, transfer, pet consent, image history, templates, pending drafts, Day Care and policy approval. Tests cover replay, concurrency, injected rollback, boundary times and recovery. Replay assertions use the actual winning concurrent request.

`test_d1.mjs` repeats key atomic/concurrent/failure scenarios on local D1/workerd, including all 23 migrations and policy approval. Set `STAY_PASS_MINIFLARE_MODULE` to an installed Miniflare module URL when it is not in local dependencies. `python -m cloudflare.test_staging` uses synthetic legacy data and checks the existing Worker, access identity, timelines, payment/UI operations and recovery. Original PDF fixtures remain unchanged. Actual Cloudflare Browser Run produced TH/EN PNG and JPG fixtures with original embedded fonts; full policy layout was additionally checked in Chrome.

## Deliberately guarded cases

Leap-day purchase expiry, cross-size renewal, transfers with open commitments, close-in rescheduling, Day Care over 24 hours, below-quarter-day cancellation fractions and unsupported dependent historical reversals require individual review. No arbitrary unlinked browser credit-edit endpoint is exposed. Images are snapshots, not authorization to use current credits. Public links never use sequential Pass numbers as authentication.
