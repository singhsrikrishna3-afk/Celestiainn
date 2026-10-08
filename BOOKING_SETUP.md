# Celestia Inn — Online Booking Setup

The site now takes real reservations: a guest picks dates, sees live availability
and a price, pays the full amount through Razorpay, and the nights are locked in.

Nothing works until the five steps below are done. Until then the booking form
quietly falls back to the inquiry flow, so the live site never shows an error.

---

## ⚠️ Before you go live: set your real rates

`db/schema.sql` seeds THP with **placeholder pricing**:

| Field | Placeholder | Meaning |
|---|---|---|
| `base_rate_inr` | ₹4,500 | Per night, covers up to `base_guests` |
| `base_guests` | 2 | Guests included in the base rate |
| `extra_guest_rate_inr` | ₹1,200 | Per extra guest, per night |
| `max_guests` | 6 | Hard cap on the booking form |
| `min_nights` / `max_nights` | 1 / 21 | Stay length limits |
| `tax_percent` | 12.00 | GST — 12% up to ₹7,500/night, **18% above** |

Change them in the Supabase table editor at any time; the site picks the new
values up on the next page load. **Rates are never read from the browser** — the
server always re-prices from this table, so a guest cannot alter what they pay.

---

## 1. Supabase (availability database)

1. Create a free project at [supabase.com](https://supabase.com).
2. Open **SQL Editor**, paste all of `db/schema.sql`, and run it.
3. Go to **Project Settings → API** and copy:
   - the **Project URL** → `SUPABASE_URL`
   - the **`service_role`** key → `SUPABASE_SERVICE_ROLE_KEY`

> The `service_role` key bypasses all database security. It belongs only in
> Vercel's environment variables — never in the site's HTML or JavaScript.

Bookings appear in **Table Editor → bookings**. That table is your reservation
list: guest details, dates, amount paid, and the Razorpay payment id.

## 2. Razorpay (payments)

1. Sign up at [razorpay.com](https://razorpay.com) and complete KYC for the LLP.
2. **Account & Settings → API Keys → Generate Test Key**. Copy both halves into
   `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET`.
3. **Settings → Webhooks → Add New Webhook**:
   - URL: `https://YOUR-DOMAIN/api/razorpay-webhook`
   - Secret: invent a strong one, copy it into `RAZORPAY_WEBHOOK_SECRET`
   - Active events: `payment.captured`, `payment.failed`, `order.paid`

The webhook is what makes a booking trustworthy: if a guest's browser crashes
after paying, the webhook still confirms the reservation.

## 3. Environment variables

Copy every key from `.env.example` into **Vercel → Project → Settings →
Environment Variables**. Set them for Production *and* Preview.

Guest confirmation emails are optional — set `RESEND_API_KEY` and
`BOOKING_FROM_EMAIL` ([resend.com](https://resend.com), free tier is plenty) to
switch them on. Without them, guests still see their full confirmation and
reference on screen, and you still get an email for every booking via the
Web3Forms key the site already uses.

## 4. Deploy

Push to GitHub and import the repo in Vercel. No build step and no dependencies —
Vercel serves the static files and turns each file in `api/` into a function
automatically.

## 5. Test before taking real money

With **test** keys (`rzp_test_…`), make a booking using Razorpay's test card
`4111 1111 1111 1111`, any future expiry, any CVV. Then check:

- [ ] A row appears in Supabase `bookings` with status `paid`
- [ ] The confirmation screen shows a `CI-XXXXXX` reference
- [ ] You receive the booking notification email
- [ ] Those dates now show as unavailable on the form
- [ ] Razorpay Dashboard → Webhooks shows a successful delivery

Then swap to live keys (`rzp_live_…`) and redeploy.

---

## How it holds together

```
Guest picks dates
      │
      ▼
GET /api/availability ........ rate card + nights already taken
      │
      ▼
POST /api/create-order ....... re-prices server-side, writes a PENDING
      │                        booking that LOCKS the dates, opens a
      │                        Razorpay order
      ▼
Razorpay Checkout ............ UPI / card / netbanking / wallet
      │
      ├──► POST /api/verify-payment ... instant confirmation for the guest
      │
      └──► POST /api/razorpay-webhook . authoritative server-to-server record
```

**Double-booking is prevented by the database, not by application code.** The
`bookings_no_overlap` exclusion constraint makes two overlapping stays for one
property physically unstorable. If two guests pay for the same nights in the
same instant, one insert fails and that guest is told to pick other dates.

**Abandoned checkouts release themselves.** A pending booking holds its dates
for `BOOKING_HOLD_MINUTES` (default 15). After that the nights return to the
calendar automatically — no cron job involved.

**Money and dates can't drift apart.** The amount charged is always computed
from the `properties` table, never from the browser. Both confirmation paths
are idempotent, so a webhook retry cannot double-confirm or double-count.

### Endpoints

| Route | Purpose |
|---|---|
| `GET /api/availability` | Rate card + booked date ranges |
| `POST /api/create-order` | Validate, price, hold dates, open Razorpay order |
| `POST /api/verify-payment` | Verify the browser callback, confirm instantly |
| `POST /api/razorpay-webhook` | Authoritative confirmation + failure handling |
| `GET /api/booking` | Guest looks a reservation up (reference **and** email) |

### Day-to-day

- **See bookings:** Supabase → Table Editor → `bookings`
- **Change prices:** Supabase → Table Editor → `properties`
- **Close dates (maintenance, a private guest):** add a row to `bookings` with
  `status = 'paid'` and the dates to block — the constraint keeps them sold out
- **Pause online booking:** set `properties.active = false`; the form reverts
  to collecting inquiries
- **Refund:** issue it in the Razorpay dashboard, then set that booking's
  `status` to `cancelled` in Supabase to free the dates

### Upcoming properties

Only THP is bookable. The other three collections still collect inquiries by
email, exactly as before. To open one for booking: add a row to `properties`,
then in `index.html` give its `<option>` a `data-bookable="true"` attribute and
set its `value` to the new property id.
