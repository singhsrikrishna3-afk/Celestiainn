/**
 * POST /api/create-order
 *
 * Validates the stay, prices it server-side, writes a short-lived pending
 * booking that holds the dates, and opens a matching Razorpay order.
 *
 * The pending row is what makes the hold real: the exclusion constraint in
 * db/schema.sql rejects any overlapping stay, so the dates are locked the
 * instant the row lands — before the guest reaches the payment sheet.
 */
import {
  handler, json, readJson, assertEnv, config,
  loadProperty, validateStay, validateGuest, quote,
  sb, makeReference, releaseExpiredHolds,
  HttpError, PG_EXCLUSION_VIOLATION,
} from './_lib.js';

export default handler(async (request) => {
  assertEnv();

  const body = await readJson(request);
  const property = await loadProperty(body.property || 'thp');

  const stay = validateStay(property, {
    checkIn: body.checkIn,
    checkOut: body.checkOut,
    guests: body.guests,
  });
  const guest = validateGuest(body);

  // Price is computed here, from the database rate. Whatever total the browser
  // displayed is ignored — a tampered client cannot change what is charged.
  const q = quote(property, stay.checkIn, stay.checkOut, stay.guests);
  if (q.total <= 0) {
    throw new HttpError(500, 'pricing_error', 'Could not price this stay. Please contact us.');
  }

  await releaseExpiredHolds();

  const reference = makeReference();
  const holdExpiresAt = new Date(Date.now() + config.holdMinutes * 60_000).toISOString();

  // --- Hold the dates -------------------------------------------------------
  let booking;
  try {
    const rows = await sb('bookings', {
      method: 'POST',
      prefer: 'return=representation',
      body: {
        reference,
        property_id: property.id,
        guest_name: guest.name,
        guest_email: guest.email,
        guest_phone: guest.phone,
        guest_notes: guest.notes,
        check_in: stay.checkIn,
        check_out: stay.checkOut,
        guests: stay.guests,
        rate_per_night_inr: q.ratePerNight,
        subtotal_inr: q.subtotal,
        tax_inr: q.tax,
        total_inr: q.total,
        status: 'pending',
        hold_expires_at: holdExpiresAt,
      },
    });
    booking = rows[0];
  } catch (err) {
    if (err.pgCode === PG_EXCLUSION_VIOLATION) {
      throw new HttpError(409, 'dates_unavailable',
        'Those nights have just been taken. Please pick different dates.');
    }
    throw err;
  }

  // --- Open the Razorpay order ---------------------------------------------
  let order;
  try {
    const auth = btoa(`${config.razorpayKeyId}:${config.razorpayKeySecret}`);
    const res = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: { authorization: `Basic ${auth}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        amount: q.total * 100,           // Razorpay works in paise
        currency: 'INR',
        receipt: reference,
        notes: {
          reference,
          booking_id: booking.id,
          property: property.name,
          stay: `${stay.checkIn} to ${stay.checkOut}`,
          guests: String(stay.guests),
        },
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data?.error?.description || `Razorpay responded ${res.status}`);
    }
    order = data;
  } catch (err) {
    // Payment setup failed, so release the hold immediately rather than
    // leaving the dates blocked for the full hold window.
    console.error('Razorpay order creation failed:', err);
    await sb(`bookings?id=eq.${booking.id}`, {
      method: 'PATCH', body: { status: 'failed' }, prefer: 'return=minimal',
    }).catch(() => {});
    throw new HttpError(502, 'payment_setup_failed',
      'We could not reach the payment provider. Please try again in a moment.');
  }

  await sb(`bookings?id=eq.${booking.id}`, {
    method: 'PATCH',
    body: { razorpay_order_id: order.id },
    prefer: 'return=minimal',
  });

  return json({
    reference,
    bookingId: booking.id,
    razorpayKeyId: config.razorpayKeyId,   // publishable key — safe in the browser
    orderId: order.id,
    amountInr: q.total,
    amountPaise: q.total * 100,
    holdExpiresAt,
    quote: q,
    property: { id: property.id, name: property.name, location: property.location },
    guest: { name: guest.name, email: guest.email, phone: guest.phone },
    stay: { checkIn: stay.checkIn, checkOut: stay.checkOut, guests: stay.guests, nights: q.nights },
  }, 201);
}, { methods: ['POST'] });
