/**
 * Marking a booking paid — shared by the browser callback and the webhook.
 *
 * Both paths race by design: whichever arrives first confirms the booking and
 * the other becomes a no-op. Idempotency comes from the status filter in the
 * PATCH, so a Razorpay webhook retry can never double-send a confirmation.
 */
import { sb, config, inr } from './_lib.js';

export async function markPaid({ orderId, paymentId, amountPaise }) {
  const rows = await sb(`bookings?razorpay_order_id=eq.${orderId}&select=*`);
  const booking = rows?.[0];
  if (!booking) {
    console.warn(`markPaid: no booking for Razorpay order ${orderId}`);
    return { booking: null, alreadyPaid: false };
  }

  if (booking.status === 'paid') {
    return { booking, alreadyPaid: true };
  }

  // Guard against an amount that does not match what we priced.
  if (amountPaise != null && Number(amountPaise) !== booking.total_inr * 100) {
    console.error(
      `markPaid: amount mismatch on ${booking.reference} — ` +
      `captured ${amountPaise} paise, expected ${booking.total_inr * 100}`,
    );
  }

  // status=eq.pending makes this a compare-and-set: only one caller wins.
  const updated = await sb(
    `bookings?razorpay_order_id=eq.${orderId}&status=eq.pending`,
    {
      method: 'PATCH',
      prefer: 'return=representation',
      body: {
        status: 'paid',
        razorpay_payment_id: paymentId,
        amount_paid_inr: amountPaise != null ? Math.round(Number(amountPaise) / 100) : booking.total_inr,
        hold_expires_at: null,
      },
    },
  );

  // Lost the race: the other path already confirmed it.
  if (!updated?.length) {
    return { booking: { ...booking, status: 'paid' }, alreadyPaid: true };
  }

  const confirmed = updated[0];
  await notifyOwner(confirmed).catch((err) => console.warn('Owner notification failed:', err.message));
  await emailGuest(confirmed).catch((err) => console.warn('Guest email failed:', err.message));

  return { booking: confirmed, alreadyPaid: false };
}

export async function markFailed(orderId, reason = 'payment_failed') {
  // Only a still-pending booking can fail; never downgrade a paid one.
  await sb(`bookings?razorpay_order_id=eq.${orderId}&status=eq.pending`, {
    method: 'PATCH',
    prefer: 'return=minimal',
    body: { status: 'failed', hold_expires_at: null },
  });
  console.info(`Booking for order ${orderId} marked failed (${reason}); dates released.`);
}

/** Reuses the Web3Forms key the site already uses for inquiries. */
async function notifyOwner(b) {
  if (!config.ownerEmailKey) return;

  await fetch('https://api.web3forms.com/submit', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      access_key: config.ownerEmailKey,
      subject: `CONFIRMED BOOKING ${b.reference} — ${b.check_in} to ${b.check_out}`,
      from_name: 'Celestia Inn Bookings',
      'Booking Reference': b.reference,
      'Status': 'PAID IN FULL',
      'Guest Name': b.guest_name,
      'Guest Email': b.guest_email,
      'Guest Phone': b.guest_phone,
      'Check-in': b.check_in,
      'Check-out': b.check_out,
      'Nights': String(b.nights),
      'Guests': String(b.guests),
      'Amount Paid': inr(b.amount_paid_inr),
      'Razorpay Payment ID': b.razorpay_payment_id || '—',
      'Guest Notes': b.guest_notes || '—',
    }),
  });
}

/**
 * Guest confirmation email. Optional: set RESEND_API_KEY and BOOKING_FROM_EMAIL
 * to switch it on. Without them the guest still sees full confirmation details
 * and their reference on screen.
 */
async function emailGuest(b) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.BOOKING_FROM_EMAIL;
  if (!apiKey || !from) return;

  const html = `
    <div style="font-family:Georgia,serif;max-width:560px;margin:0 auto;color:#2b2520">
      <h1 style="font-size:22px;color:#8a6d3b;margin:0 0 4px">Your stay is confirmed</h1>
      <p style="margin:0 0 24px;color:#6b6257">Celestia Inn LLP</p>
      <p>Dear ${escapeHtml(b.guest_name)},</p>
      <p>Thank you for booking with us. Your reservation is confirmed and paid in full.</p>
      <table style="width:100%;border-collapse:collapse;margin:24px 0;font-family:Helvetica,Arial,sans-serif;font-size:14px">
        ${row('Reference', b.reference)}
        ${row('Check-in', b.check_in)}
        ${row('Check-out', b.check_out)}
        ${row('Nights', b.nights)}
        ${row('Guests', b.guests)}
        ${row('Total paid', inr(b.amount_paid_inr))}
      </table>
      <p style="font-size:14px;color:#6b6257">
        Please keep your reference handy. Reply to this email for directions,
        airport or taxi help, or any special arrangements.
      </p>
      <p style="font-size:14px">We look forward to hosting you.</p>
    </div>`;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      from,
      to: [b.guest_email],
      subject: `Booking confirmed — ${b.reference} — Celestia Inn`,
      html,
    }),
  });
  if (!res.ok) throw new Error(`Resend responded ${res.status}`);
}

function row(label, value) {
  return `<tr>
    <td style="padding:8px 0;border-bottom:1px solid #e8e2d8;color:#6b6257">${label}</td>
    <td style="padding:8px 0;border-bottom:1px solid #e8e2d8;text-align:right;font-weight:600">${escapeHtml(String(value))}</td>
  </tr>`;
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}
