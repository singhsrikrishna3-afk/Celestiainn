/**
 * Shared helpers for the Celestia Inn booking API.
 *
 * Web-standard handlers (Request -> Response) so the raw request body stays
 * readable for Razorpay signature verification, and Web Crypto so the same
 * code runs on Vercel's Node and Edge runtimes. Zero npm dependencies.
 */

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID;
const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET;
const RAZORPAY_WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET;

export const config = {
  razorpayKeyId: RAZORPAY_KEY_ID,
  razorpayKeySecret: RAZORPAY_KEY_SECRET,
  razorpayWebhookSecret: RAZORPAY_WEBHOOK_SECRET,
  holdMinutes: Number(process.env.BOOKING_HOLD_MINUTES || 15),
  ownerEmailKey: process.env.WEB3FORMS_ACCESS_KEY || '',
};

/** Throws at request time (not import time) if the deployment is misconfigured. */
export function assertEnv() {
  const missing = [
    ['SUPABASE_URL', SUPABASE_URL],
    ['SUPABASE_SERVICE_ROLE_KEY', SUPABASE_SERVICE_KEY],
    ['RAZORPAY_KEY_ID', RAZORPAY_KEY_ID],
    ['RAZORPAY_KEY_SECRET', RAZORPAY_KEY_SECRET],
  ].filter(([, v]) => !v).map(([k]) => k);

  if (missing.length) {
    throw new HttpError(500, 'server_misconfigured',
      `Missing environment variables: ${missing.join(', ')}`);
  }
}

// ---------------------------------------------------------------------------
// HTTP plumbing
// ---------------------------------------------------------------------------

export class HttpError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

export function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...headers,
    },
  });
}

/**
 * Wraps a handler so thrown HttpErrors become clean JSON and anything else
 * becomes a 500 without leaking internals to the guest.
 *
 * The returned function accepts BOTH calling conventions:
 *   - Web:  (Request) -> Response            — Vercel's web handlers, Edge runtime
 *   - Node: (req, res)                       — classic Node serverless, local http servers
 * Vercel has used both over time, and getting it wrong would break every
 * endpoint, so we detect per call rather than betting on one.
 */
export function handler(fn, { methods = ['GET'] } = {}) {
  const web = async (request) => {
    try {
      if (!methods.includes(request.method)) {
        return json({ error: 'method_not_allowed' }, 405, { allow: methods.join(', ') });
      }
      return await fn(request);
    } catch (err) {
      if (err instanceof HttpError) {
        return json({ error: err.code, message: err.message, ...err.extra }, err.status);
      }
      console.error('Unhandled booking API error:', err);
      return json({ error: 'internal_error', message: 'Something went wrong. Please try again.' }, 500);
    }
  };

  return async (a, b) => {
    if (!b && typeof a?.headers?.get === 'function') return web(a);   // Web signature
    return nodeAdapter(web, a, b);                                    // Node signature
  };
}

/** Bridges a Node (req, res) invocation onto the Web handler. */
async function nodeAdapter(web, req, res) {
  const host = req.headers.host || 'localhost';
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const request = new Request(`${proto}://${host}${req.url}`, {
    method: req.method,
    headers: req.headers,
    body: ['GET', 'HEAD'].includes(req.method) ? undefined : await rawBody(req),
  });

  const out = await web(request);
  res.statusCode = out.status;
  out.headers.forEach((v, k) => res.setHeader(k, v));
  res.end(Buffer.from(await out.arrayBuffer()));
}

/**
 * The exact bytes the client sent. Signature verification depends on this
 * being byte-identical, so re-serialising an already-parsed body is only ever
 * a last resort — and is logged when it happens.
 */
async function rawBody(req) {
  if (req.rawBody) return req.rawBody;                    // Vercel exposes this

  if (typeof req[Symbol.asyncIterator] === 'function' && !req.readableEnded) {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    if (chunks.length) return Buffer.concat(chunks);
  }

  if (req.body !== undefined && req.body !== null) {
    console.warn('Falling back to a re-serialised body; webhook signatures may not verify.');
    return typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
  }
  return undefined;
}

export async function readJson(request) {
  try {
    const text = await request.text();
    return text ? JSON.parse(text) : {};
  } catch {
    throw new HttpError(400, 'invalid_json', 'Request body was not valid JSON.');
  }
}

// ---------------------------------------------------------------------------
// Supabase (PostgREST over fetch)
// ---------------------------------------------------------------------------

/** Postgres SQLSTATE for exclusion_violation — our overlapping-stay guard. */
export const PG_EXCLUSION_VIOLATION = '23P01';

export async function sb(path, { method = 'GET', body, prefer, headers = {} } = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      'content-type': 'application/json',
      ...(prefer ? { prefer } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await res.text();
  const data = text ? JSON.parse(text) : null;

  if (!res.ok) {
    const err = new HttpError(502, 'database_error', data?.message || 'Database request failed.');
    err.pgCode = data?.code;
    err.pgDetail = data?.details;
    throw err;
  }
  return data;
}

// ---------------------------------------------------------------------------
// Dates. Everything is a plain YYYY-MM-DD string in Asia/Kolkata; no Date
// objects crossing timezone boundaries, so no off-by-one-day bugs.
// ---------------------------------------------------------------------------

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Today in IST, as YYYY-MM-DD. en-CA formats as ISO. */
export function istToday() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

export function isValidDate(s) {
  if (typeof s !== 'string' || !ISO_DATE.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function nightsBetween(checkIn, checkOut) {
  const a = Date.UTC(...checkIn.split('-').map((n, i) => (i === 1 ? +n - 1 : +n)));
  const b = Date.UTC(...checkOut.split('-').map((n, i) => (i === 1 ? +n - 1 : +n)));
  return Math.round((b - a) / 86400000);
}

export function addDays(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Pricing — the single source of truth. The browser shows an estimate; this
// is what the guest is actually charged.
// ---------------------------------------------------------------------------

export function quote(property, checkIn, checkOut, guests) {
  const nights = nightsBetween(checkIn, checkOut);
  const extraGuests = Math.max(0, guests - property.base_guests);
  const ratePerNight = property.base_rate_inr + extraGuests * property.extra_guest_rate_inr;
  const subtotal = ratePerNight * nights;
  const tax = Math.round((subtotal * Number(property.tax_percent)) / 100);

  return {
    nights,
    guests,
    extraGuests,
    ratePerNight,
    subtotal,
    tax,
    taxPercent: Number(property.tax_percent),
    total: subtotal + tax,
  };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

// Deliberately permissive: the goal is to reject obvious typos, not to police
// the long tail of legitimate addresses.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;

export function validateStay(property, { checkIn, checkOut, guests }) {
  if (!isValidDate(checkIn)) throw new HttpError(400, 'invalid_check_in', 'Please choose a valid check-in date.');
  if (!isValidDate(checkOut)) throw new HttpError(400, 'invalid_check_out', 'Please choose a valid check-out date.');

  const today = istToday();
  if (checkIn < today) throw new HttpError(400, 'check_in_past', 'Check-in cannot be in the past.');
  if (checkOut <= checkIn) throw new HttpError(400, 'invalid_range', 'Check-out must be after check-in.');

  const nights = nightsBetween(checkIn, checkOut);
  if (nights < property.min_nights) {
    throw new HttpError(400, 'below_min_nights',
      `This stay has a ${property.min_nights}-night minimum.`);
  }
  if (nights > property.max_nights) {
    throw new HttpError(400, 'above_max_nights',
      `Stays longer than ${property.max_nights} nights are arranged directly — please contact us.`);
  }
  if (checkIn > addDays(today, property.max_advance_days)) {
    throw new HttpError(400, 'too_far_ahead',
      `Bookings open up to ${property.max_advance_days} days ahead.`);
  }

  const n = Number(guests);
  if (!Number.isInteger(n) || n < 1) throw new HttpError(400, 'invalid_guests', 'Please choose how many guests are staying.');
  if (n > property.max_guests) {
    throw new HttpError(400, 'too_many_guests',
      `This stay sleeps up to ${property.max_guests} guests. For a larger group, please contact us.`);
  }

  return { checkIn, checkOut, guests: n, nights };
}

export function validateGuest({ name, email, phone, notes }) {
  const cleanName = String(name || '').trim();
  const cleanEmail = String(email || '').trim().toLowerCase();
  const cleanPhone = String(phone || '').trim();

  if (cleanName.length < 2) throw new HttpError(400, 'invalid_name', 'Please enter your full name.');
  if (cleanName.length > 120) throw new HttpError(400, 'invalid_name', 'That name is too long.');
  if (!EMAIL_RE.test(cleanEmail) || cleanEmail.length > 200) {
    throw new HttpError(400, 'invalid_email', 'Please enter a valid email address — your confirmation goes there.');
  }
  if (cleanPhone.replace(/\D/g, '').length < 8) {
    throw new HttpError(400, 'invalid_phone', 'Please enter a valid contact number.');
  }

  return {
    name: cleanName,
    email: cleanEmail,
    phone: cleanPhone,
    notes: String(notes || '').trim().slice(0, 1000) || null,
  };
}

export async function loadProperty(propertyId) {
  const id = String(propertyId || '').trim();
  if (!/^[a-z0-9_-]{1,40}$/.test(id)) {
    throw new HttpError(400, 'invalid_property', 'Unknown stay.');
  }

  const rows = await sb(`properties?id=eq.${id}&active=is.true&select=*`);
  if (!rows?.length) {
    throw new HttpError(404, 'property_unavailable', 'That stay is not open for online booking yet.');
  }
  return rows[0];
}

// ---------------------------------------------------------------------------
// Crypto — HMAC-SHA256 via Web Crypto, constant-time compared.
// ---------------------------------------------------------------------------

export async function hmacHex(secret, payload) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Length-independent, early-exit-free comparison. */
export function timingSafeEqual(a, b) {
  const x = String(a || '');
  const y = String(b || '');
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}

// ---------------------------------------------------------------------------
// Booking references: CI-XXXXXX, Crockford-ish alphabet (no I/L/O/U) so staff
// reading one over the phone cannot garble it.
// ---------------------------------------------------------------------------

const REF_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function makeReference() {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  const body = [...bytes].map((b) => REF_ALPHABET[b % REF_ALPHABET.length]).join('');
  return `CI-${body}`;
}

/**
 * Releases pending holds whose payment window has closed, freeing their dates.
 * Called before availability reads and before creating an order, so no cron job
 * is needed to keep the calendar truthful.
 */
export async function releaseExpiredHolds() {
  try {
    await sb(`bookings?status=eq.pending&hold_expires_at=lt.${new Date().toISOString()}`, {
      method: 'PATCH',
      body: { status: 'expired' },
      prefer: 'return=minimal',
    });
  } catch (err) {
    // Never block a booking because cleanup failed; the constraint still holds.
    console.warn('Could not release expired holds:', err.message);
  }
}

export function inr(amount) {
  return `₹${Number(amount).toLocaleString('en-IN')}`;
}
