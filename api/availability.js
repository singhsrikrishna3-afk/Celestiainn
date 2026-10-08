/**
 * GET /api/availability?property=thp[&from=YYYY-MM-DD&to=YYYY-MM-DD]
 *
 * Returns the stay's public rate card plus the date ranges already taken, so
 * the browser can grey out unavailable nights and quote a live estimate.
 * Deliberately exposes no guest data — only ranges.
 */
import {
  handler, json, assertEnv, loadProperty, sb,
  istToday, addDays, isValidDate, releaseExpiredHolds,
} from './_lib.js';

export default handler(async (request) => {
  assertEnv();

  const url = new URL(request.url);
  const property = await loadProperty(url.searchParams.get('property') || 'thp');

  // Drop abandoned holds first, otherwise the calendar shows nights as taken
  // that nobody actually paid for.
  await releaseExpiredHolds();

  const today = istToday();
  const fromParam = url.searchParams.get('from');
  const toParam = url.searchParams.get('to');

  const from = isValidDate(fromParam) && fromParam > today ? fromParam : today;
  const to = isValidDate(toParam)
    ? toParam
    : addDays(from, property.max_advance_days);

  // Any stay that overlaps the window: starts before it ends AND ends after it starts.
  const rows = await sb(
    `bookings?property_id=eq.${property.id}` +
    `&status=in.(pending,paid)` +
    `&check_in=lt.${to}&check_out=gt.${from}` +
    `&select=check_in,check_out&order=check_in.asc`,
  );

  return json({
    property: {
      id: property.id,
      name: property.name,
      location: property.location,
      baseRateInr: property.base_rate_inr,
      baseGuests: property.base_guests,
      extraGuestRateInr: property.extra_guest_rate_inr,
      maxGuests: property.max_guests,
      minNights: property.min_nights,
      maxNights: property.max_nights,
      maxAdvanceDays: property.max_advance_days,
      taxPercent: Number(property.tax_percent),
      currency: 'INR',
    },
    window: { from, to, today },
    // Half-open ranges: checkOut is the first free morning.
    booked: (rows || []).map((r) => ({ checkIn: r.check_in, checkOut: r.check_out })),
  });
}, { methods: ['GET'] });
