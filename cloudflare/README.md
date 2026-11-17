# Cloudflare staging — customer timeline

This Worker is a read-only migration milestone. It serves shared customer timelines and private activity photos on Cloudflare Workers, D1 and R2. The Mac application remains the full application. The timeline Worker can export PDF when Browser Run and the trusted `PUBLIC_ORIGIN` are configured. It does not implement staff sign-in or writes. A snapshot stays unchanged until a new import, so it is unsuitable for customer production links.

## Test locally

Run `npm ci --prefix cloudflare` from the project root to install the locked QR dependency before testing or building.

From the project root, use Python 3.12 with the existing requirements and Node 24.

```sh
python -m cloudflare.test_staging
```

This creates a synthetic backup, imports the generated SQL with foreign keys enabled and exercises the Worker against the migrated data. It checks scoped photos, hidden activities, expiration and revocation. It also checks the draft D1 payment operation for overpayment, retries, and cancellation. The D1 and R2 interfaces are simulated for this check. The payment operation has no public route and will need staff authentication before it becomes available.

## Migrate a backup into a private bundle

From the project root, use a ZIP created by Little Paws' backup screen. For staging, use synthetic data. Keep the ZIP and generated files outside the Git working tree.

```sh
python -m cloudflare.export_data /path/to/fixture.zip /path/to/new-private-directory
```

The bundle contains `data.sql`, `objects.json` (key, size and SHA-256), and the `objects/` tree. It includes all exported records, including account hashes and tokens, so handle the entire bundle as private data. The script validates the archive, checks database references, moves photo bytes to object files in the bundle, preserves row IDs and replaces each photo BLOB with its R2 object key. It does not contact Cloudflare.

Receipt attachments retain their original bytes under `receipts/` in R2 with references in D1. When the backup contains a payment QR, the bundle includes the original file at `payment/payment-qr.jpg`. For older backups, use the original JPEG from the Mac installation for that same key. Keep the bucket private. The staff Worker checks Access before serving either file. Missing attachments return 404 and a missing QR hides the link in the staff preview. Configure any deployment tokens and application secrets outside Git using Cloudflare Secrets.

## Cloudflare configuration

1. Create a dedicated staging D1 database and private R2 bucket if the Cloudflare account supports them. Do not enable public R2 access.
2. Copy `wrangler.toml` to a private configuration file beside it or provide environment-specific configuration in deployment. Replace the example UUID and resource names with your staging bindings. Preserve binding names `DB` and `MEDIA`. To enable timeline PDF, bind `BROWSER` and set `PUBLIC_ORIGIN` to the exact HTTPS origin of this Worker. The PDF endpoint uses only the already-authorized view and R2 image routes, and checks link activity again before returning the file.
3. Use `wrangler d1 execute <staging-db> --remote --file <private-directory>/data.sql` against an empty staging D1 database. Upload the files under `objects/` to the matching private R2 keys, without the local `objects/` prefix. Verify counts and checksums before inviting staging testers.
4. For a pre-existing staging D1 without `care_share_links.view_count`, apply `timeline_views.sql` before deploying. New exports include that field. From `cloudflare/`, deploy with `npx wrangler deploy --config <staging-config>`. Test a synthetic token, a different dog's photo ID, and an expired/revoked token. Only the timeline, optional PDF, and scoped photo routes are exposed.
5. Production deployment also needs the staff application port, write parity, export parity and source-to-cloud migration rehearsal. See the project handoff.

D1 transactions use batches. Port staff write operations individually so checks and writes stay atomic, including concurrent checkout, deposits, balances and coupon redemption. Reuse the existing business rules and test duplicate submissions. Port authentication/session controls and move PDF/PNG rendering to a route that fits the target plan's CPU and rendering limits. A browser staging deployment does not migrate or start serving the Mac's database.

- [D1 import and export](https://developers.cloudflare.com/d1/best-practices/import-export-data/)
- [D1 batch transactions](https://developers.cloudflare.com/d1/worker-api/d1-database/)
- [R2 Worker binding](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/)

## Staff preview

`staff.mjs` is a separate Worker for authenticated staff. It can add, edit, and archive customer records and add, edit and archive dog profiles. It displays dog photos and stay history. Staff can select or capture a dog photo. The browser resizes the photo to JPEG with a 1024 px maximum edge, and the Worker accepts at most 512 KiB. Photo replacements use versioned private R2 objects and update the D1 reference before removing the prior object. The browser must be able to decode the selected format. Archiving hides the customer and dogs from the directory while retaining linked data. It also lists current stays and pending bookings with their details and payment history, and can create, edit and remove pending bookings. Booking writes warn about shop holidays, overlapping stays or bookings for the same dog, and capacity. A confirmation is valid for the checked occupancy and holiday snapshot. The calendar supports month, week and day views with shop holidays, can check in a priced booking with a signed Thai or English consent, records the optional packed items and physical exam, displays the resulting stay summary and accepts remaining payments from it, supports check-out, records and removes booking deposits, and records payments for outstanding stays with the D1 balance check and duplicate protection in `stay_payments.mjs`. This preview does not replace the full Mac staff application.

The sample `wrangler.staff.toml` disables public and preview URLs. To set up a private staging instance, use a separate hostname protected by Cloudflare Access, point `DB` to the staging database and `MEDIA` to the staging private bucket, apply `staff_access.sql` and `booking_deposits.sql` after the data import, then apply the one-time migrations `customer_writes.sql` `dog_writes.sql` `booking_writes.sql` `direct_checkin.sql` `coupon_admin.sql` `care_writes.sql` and `care_photo_writes.sql`, set `ACCESS_AUDIENCE` to that app's audience, and set `TIMELINE_ORIGIN` to the public timeline Worker's HTTPS origin. Provision the authorized email-to-existing-user mapping in `staff_access_identities` using lowercase email addresses. Never infer staff identities from customer emails. Requests without trusted Access context, a matching audience, and an active mapped account are denied. Keep the staff Worker separate from the customer link Worker.

For local development only, Wrangler's `[access.dev]` and `[access.dev.identity]` blocks can simulate the audience and a fixture staff identity. Use a synthetic D1 import and remove those test settings from deployment configuration.

[Cloudflare Access integration for Workers](https://developers.cloudflare.com/workers/configuration/cloudflare-access/)

[Cloudflare Browser Run PDF endpoint](https://developers.cloudflare.com/browser-run/quick-actions/pdf-endpoint/) · [Browser Run Free and Paid usage limits](https://developers.cloudflare.com/browser-run/pricing/)


To regenerate the check-in terms artifact after editing the Mac application terms, their translation or the check-in fields, run `python -m cloudflare.sync_terms` from the project root. Check-in stores a snapshot of both versions and the customer's signature. The booking is converted in one D1 batch with its dogs, deposits and any additional check-in payment. If the booking revision or deposit balance changes, staff must reload before confirming.


Walk-in check-in reuses the booking form's rate and dog selection, then collects intake, consent and payment directly into a stay. The preview has no writes. Both check-in flows can quote and redeem an existing percentage or fixed coupon. Redemption checks the live limit in the same transaction as the stay and calculates percentage discounts from the full price before deposits. The final save checks ownership, pricing and current scheduling warnings, and deduplicates retries without creating a placeholder booking.


Administrators can create, edit and archive coupons, and switch between active, used and expired listings. The coupon preview renders a shareable PNG in the browser with the six-digit code and a numeric QR, expiration, use limit and optional minimum spend. The Cloudflare preview currently uses the Little Paws green palette.


The public timeline records successful HTML page openings against the share link. Photo and PDF routes and speculative prefetches do not increment the counter. Stay summaries expose counts to authorized staff. The staff finance overview attributes linked refunds back to their original receipt months in receipt order. The cash-flow total keeps actual transaction dates.


When updating the Worker in the dashboard editor, copy source from a UTF-8-aware editor or use an ASCII transport with JavaScript Unicode escapes. Browsers can use a legacy encoding for plain text served without a charset, corrupting Thai strings before upload. After deployment, open the synthetic timeline in both languages and verify the Thai title, activity labels and expiry text on the served page.


The staff stay summary opens a per-dog timeline for viewing, adding, editing and deleting activity, sharing a selected day's activities and creating or revoking the customer link. The staff-only preview filters to customer-visible activity and does not count as a customer view. Set `TIMELINE_ORIGIN` to the deployed timeline origin to enable link creation and copying.

Activity editing supports changing the timestamp, type, text and visibility while checked in. The staff form displays existing photos and allows up to four photos per event to be uploaded or removed. The browser resizes supported photos to JPEG, and the Worker enforces the 1024 px edge and 512 KiB limits. Deploy the customer timeline Worker with support for the versioned `care/uploads/` keys before enabling the photo form in an online staff deployment.


Staff document exports support booking confirmation, per-payment deposit receipt and stay summary in Thai and English. The HTML print version works without Browser Run. The `BROWSER` binding enables PDF and PNG exports. The migration bundle supplies the logo at `brand/little-paws-logo.png` and themed artwork at `brand/mascot-<theme>.webp` for upload to private R2. An authorized Sukhumvit Set web font may be supplied as `brand/sukhumvit-set.woff2`. Until then the renderer uses system and Thai fallback fonts. The HTML sent to the renderer embeds images from R2 and does not use a public URL or send session credentials.
