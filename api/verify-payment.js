/**
 * POST /api/verify-payment
 *
 * Called by the browser the moment Razorpay Checkout succeeds, so the guest
 * sees a confirmed booking without waiting on the webhook. The signature is
 * verified here too — a forged callback cannot confirm a booking.
 *
 * The webhook remains the authoritative path; this is the fast path.
 */
import {
  handler, json, readJson, assertEnv, config,
  hmacHex, timingSafeEqual, HttpError,
} from './_lib.js';
import { markPaid } from './_confirm.js';

export default handler(async (request) => {
  assertEnv();

  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = await readJson(request);

  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    throw new HttpError(400, 'missing_fields', 'Incomplete payment confirmation.');
  }

  const expected = await hmacHex(
    config.razorpayKeySecret,
    `${razorpay_order_id}|${razorpay_payment_id}`,
  );

  if (!timingSafeEqual(expected, razorpay_signature)) {
    console.error(`Invalid payment signature for order ${razorpay_order_id}`);
    throw new HttpError(400, 'invalid_signature',
      'We could not verify this payment. Please contact us before trying again.');
  }

  const { booking } = await markPaid({
    orderId: razorpay_order_id,
    paymentId: razorpay_payment_id,
  });

  if (!booking) {
    throw new HttpError(404, 'booking_not_found',
      'Payment verified but the booking was not found. Please contact us with your payment id.');
  }

  return json({
    status: booking.status,
    reference: booking.reference,
    propertyId: booking.property_id,
    guestName: booking.guest_name,
    guestEmail: booking.guest_email,
    checkIn: booking.check_in,
    checkOut: booking.check_out,
    nights: booking.nights,
    guests: booking.guests,
    totalInr: booking.total_inr,
    amountPaidInr: booking.amount_paid_inr,
  });
}, { methods: ['POST'] });
