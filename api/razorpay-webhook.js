/**
 * POST /api/razorpay-webhook
 *
 * Razorpay's server-to-server notification and the authoritative record of
 * what was actually captured. Subscribe to: payment.captured, payment.failed,
 * order.paid. Signature is verified against the RAW body, so this handler
 * must never read the request as parsed JSON first.
 */
import { handler, json, config, hmacHex, timingSafeEqual } from './_lib.js';
import { markPaid, markFailed } from './_confirm.js';

export default handler(async (request) => {
  const secret = config.razorpayWebhookSecret;
  if (!secret) {
    console.error('RAZORPAY_WEBHOOK_SECRET is not set; refusing webhook.');
    return json({ error: 'webhook_not_configured' }, 500);
  }

  const raw = await request.text();
  const signature = request.headers.get('x-razorpay-signature');

  if (!timingSafeEqual(await hmacHex(secret, raw), signature)) {
    console.error('Rejected Razorpay webhook: bad signature.');
    return json({ error: 'invalid_signature' }, 400);
  }

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }

  const event = payload.event;
  const payment = payload.payload?.payment?.entity;
  const order = payload.payload?.order?.entity;

  try {
    switch (event) {
      case 'payment.captured':
        if (payment?.order_id) {
          await markPaid({
            orderId: payment.order_id,
            paymentId: payment.id,
            amountPaise: payment.amount,
          });
        }
        break;

      case 'order.paid':
        if (order?.id) {
          await markPaid({
            orderId: order.id,
            paymentId: payment?.id || null,
            amountPaise: order.amount_paid,
          });
        }
        break;

      case 'payment.failed':
        if (payment?.order_id) await markFailed(payment.order_id, payment.error_description);
        break;

      default:
        console.info(`Ignoring unsubscribed Razorpay event: ${event}`);
    }
  } catch (err) {
    // 500 asks Razorpay to retry. markPaid is idempotent, so retries are safe.
    console.error(`Webhook handling failed for ${event}:`, err);
    return json({ error: 'processing_failed' }, 500);
  }

  return json({ received: true });
}, { methods: ['POST'] });
