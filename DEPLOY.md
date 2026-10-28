# Deploying Celestia Inn

Production is **https://www.celestiainn.in** (the apex `celestiainn.in` 308s to
`www`). It is the Vercel project `celestiainn` under
`singhsrikrishna3-5341s-projects`.

There is no build step. Vercel serves the static files and turns each file in
`api/` into a serverless function automatically.

---

## Normal path — push to `main`

```bash
git push origin main
```

The GitHub repo is connected to the Vercel project, so a push to `main` should
deploy to production and a push to any other branch should create a preview.

> **If a push does not produce a deployment**, the connection is linked but not
> firing. Check, in this order:
> 1. Vercel → `celestiainn` → Settings → Git — is **Production Branch** set to `main`?
> 2. Same page — is there an **Ignored Build Step** command that exits 0?
> 3. GitHub → Settings → Applications → Vercel — does it have access to `Celestiainn`?
>
> Until that is sorted, use the manual path below; it always works.

## Manual path — deploy from your machine

```bash
npm run deploy
```

That is `vercel --prod`. It uploads the working directory as it stands, so
commit first if you want the deploy to match the repo.

For a throwaway preview URL without touching production:

```bash
npm run deploy:preview
```

---

## Environment variables

Functions read their configuration at **build time**, so after changing any
variable you must redeploy before it takes effect.

Set them all at once, reading values straight from your keyboard into Vercel
(nothing is echoed, written to a file, or kept in shell history):

```bash
./setup-secrets.sh
```

Or one at a time:

```bash
vercel env add RAZORPAY_KEY_ID production
```

`.env.example` lists every variable with a comment on where to get it.

### Currently set

`SUPABASE_URL`, `BOOKING_HOLD_MINUTES`, `WEB3FORMS_ACCESS_KEY`

### Still missing

`SUPABASE_SERVICE_ROLE_KEY`, `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`,
`RAZORPAY_WEBHOOK_SECRET`

While these are missing the booking form falls back to collecting inquiries —
by design, so the live site never shows an error.

---

## Verifying a deploy

Confirm the HTML actually changed, rather than trusting the dashboard:

```bash
npm run verify
```

That checks the live booking API. Expect `server_misconfigured` until the
variables above are set, and the rate card afterwards.

To confirm the deployed page matches your working copy:

```bash
curl -sSL https://celestiainn.in > /tmp/live.html && diff /tmp/live.html index.html && echo "in sync"
```

To see recent deployments and spot whether one actually happened:

```bash
npm run deployments
```

---

## Before taking real payments

- [ ] Replace the placeholder rates in `db/schema.sql` — ₹4,500 base is a stand-in
- [ ] Run `db/schema.sql` in the Supabase SQL editor
- [ ] Add the Razorpay webhook: `https://www.celestiainn.in/api/razorpay-webhook`
      with `payment.captured`, `payment.failed`, `order.paid`
- [ ] Test end to end with `rzp_test_…` keys and card `4111 1111 1111 1111`
- [ ] Only then swap to `rzp_live_…` and redeploy

`BOOKING_SETUP.md` has the full detail.
