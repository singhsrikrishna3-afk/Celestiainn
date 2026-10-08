/**
 * GET /api/booking?reference=CI-XXXXXX&email=guest@example.com
 *
 * Lets a guest look their reservation up again. Both the reference AND the
 * matching email are required, so a guessed reference alone reveals nothing.
 */
import { handler, json, assertEnv, sb, HttpError } from './_lib.js';

export default handler(async (request) => {
  assertEnv();

  const url = new URL(request.url);
  const reference = (url.searchParams.get('reference') || '').trim().toUpperCase();
  const email = (url.searchParams.get('email') || '').trim().toLowerCase();

  if (!/^CI-[0-9A-Z]{6}$/.test(reference)) {
    throw new HttpError(400, 'invalid_reference', 'Please enter a reference like CI-A1B2C3.');
  }
  if (!email) {
    throw new HttpError(400, 'email_required', 'Please enter the email used for the booking.');
  }

  const rows = await sb(
    `bookings?reference=eq.${encodeURIComponent(reference)}` +
    `&guest_email=eq.${encodeURIComponent(email)}` +
    `&select=reference,status,property_id,guest_name,check_in,check_out,nights,guests,total_inr,amount_paid_inr,created_at`,
  );

  if (!rows?.length) {
    throw new HttpError(404, 'not_found',
      'No booking matches that reference and email.');
  }

  return json({ booking: rows[0] });
}, { methods: ['GET'] });
