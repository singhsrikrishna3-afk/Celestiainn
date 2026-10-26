/**
 * booking.js — Celestia Inn online reservations.
 *
 * Owns the "Book a Stay" tab whenever the selected stay is open to online
 * booking: fetches availability, quotes the stay live, blocks dates that are
 * already taken, then hands off to Razorpay Checkout and confirms the booking.
 *
 * The quote shown here is an estimate for the guest's benefit. /api/create-order
 * re-prices the stay from the database and that figure is what gets charged.
 */
(() => {
  'use strict';

  const API = {
    availability: '/api/availability',
    createOrder: '/api/create-order',
    verify: '/api/verify-payment',
  };

  const state = {
    property: null,      // rate card from the server
    booked: [],          // [{ checkIn, checkOut }] half-open ranges
    today: null,
    loaded: false,
    loadError: false,
    submitting: false,
  };

  const el = {};

  document.addEventListener('DOMContentLoaded', init);

  function init() {
    const ids = [
      'partnership-form', 'submit-btn', 'stay-destination', 'booking-live',
      'booking-inquiry-only', 'email', 'check-in-date', 'check-out-date',
      'guest-count', 'guest-notes', 'availability-note', 'quote-panel',
      'quote-rows', 'quote-total', 'quote-foot', 'form-error', 'form-note-text',
      'success-overlay', 'success-overlay-title', 'success-overlay-desc',
      'success-details', 'reset-form-btn', 'name', 'contact',
    ];
    ids.forEach((id) => { el[camel(id)] = document.getElementById(id); });

    if (!el.partnershipForm || !el.stayDestination) return;

    // Expose the hooks app.js uses to decide who handles a submit.
    window.CelestiaBooking = { isOnlineBookable, submit };

    el.stayDestination.addEventListener('change', onDestinationChange);
    ['checkInDate', 'checkOutDate', 'guestCount'].forEach((k) => {
      el[k]?.addEventListener('change', onStayChange);
    });

    // app.js registers its tab handlers first (script order), so ours runs
    // after and gets the final say on the submit button's label.
    document.querySelectorAll('.form-tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (btn.getAttribute('data-tab') === 'booking') syncMode();
      });
    });

    el.resetFormBtn?.addEventListener('click', resetAfterSuccess);

    syncMode();
    loadAvailability();
  }

  // -------------------------------------------------------------------------
  // Mode: online booking vs inquiry-only
  // -------------------------------------------------------------------------

  function isOnlineBookable() {
    const opt = el.stayDestination?.selectedOptions?.[0];
    return opt?.dataset?.bookable === 'true' && !state.loadError;
  }

  function onDestinationChange() {
    syncMode();
    if (isOnlineBookable() && !state.loaded) loadAvailability();
  }

  /** Shows the right field set and relabels the submit button. */
  function syncMode() {
    const live = isOnlineBookable();
    if (el.bookingLive) el.bookingLive.hidden = !live;
    if (el.bookingInquiryOnly) el.bookingInquiryOnly.hidden = live;

    // Required-ness follows visibility so the browser never blocks submit on a hidden field.
    toggleRequired(el.email, live);
    toggleRequired(el.checkInDate, live);
    toggleRequired(el.checkOutDate, live);

    if (el.submitBtn && isBookingTabActive()) {
      el.submitBtn.textContent = live ? nextActionLabel() : 'Submit Booking Inquiry';
    }

    // The stock footnote is written for an inquiry; a paid booking needs to say
    // what actually happens to the guest's money.
    if (el.formNoteText && isBookingTabActive()) {
      el.formNoteText.textContent = live
        ? 'Your dates are held while you pay. Payments are processed securely by '
          + 'Razorpay — Celestia Inn LLP never sees your card details.'
        : 'By submitting this form, you authorize Celestia Inn LLP to contact you regarding bookings.';
    }

    if (live) refreshQuote();
  }

  function nextActionLabel() {
    const ci = el.checkInDate?.value;
    const co = el.checkOutDate?.value;
    // Only offer to take money for a stay we can actually sell: the dates must
    // price up AND be free. Otherwise the button stays a availability prompt.
    if (!ci || !co || overlapsBooked(ci, co)) return 'Check Availability';

    const q = currentQuote();
    return q ? `Pay ${formatInr(q.total)} & Confirm` : 'Check Availability';
  }

  function isBookingTabActive() {
    return document.querySelector('.form-tab-btn.active')?.getAttribute('data-tab') === 'booking';
  }

  function toggleRequired(node, on) {
    if (!node) return;
    if (on) node.setAttribute('required', '');
    else node.removeAttribute('required');
  }

  // -------------------------------------------------------------------------
  // Availability
  // -------------------------------------------------------------------------

  async function loadAvailability({ silent = false } = {}) {
    const id = el.stayDestination.value;
    try {
      const res = await fetch(`${API.availability}?property=${encodeURIComponent(id)}`);
      if (!res.ok) throw new Error(`availability responded ${res.status}`);
      const data = await res.json();

      state.property = data.property;
      state.booked = data.booked || [];
      state.today = data.window?.today || isoToday();
      state.loaded = true;
      state.loadError = false;

      applyDateBounds();
      buildGuestOptions();
      refreshQuote();
    } catch (err) {
      console.error('Could not load availability:', err);
      if (silent) return;

      state.loadError = true;
      state.loaded = false;
      // Fall back to the inquiry flow rather than showing a broken booking form.
      syncMode();
      showError(
        '<strong>Live booking is unavailable right now.</strong> ' +
        'Leave your dates below and our reservation host will confirm by email.',
      );
    }
  }

  function applyDateBounds() {
    const p = state.property;
    if (!p || !el.checkInDate) return;

    const last = addDays(state.today, p.maxAdvanceDays || 365);
    el.checkInDate.min = state.today;
    el.checkInDate.max = last;
    el.checkOutDate.min = addDays(state.today, 1);
    el.checkOutDate.max = addDays(last, p.maxNights);
  }

  function buildGuestOptions() {
    const p = state.property;
    if (!p || !el.guestCount) return;

    const previous = Number(el.guestCount.value) || p.baseGuests;
    el.guestCount.innerHTML = '';

    for (let n = 1; n <= p.maxGuests; n++) {
      const extra = Math.max(0, n - p.baseGuests);
      const opt = document.createElement('option');
      opt.value = String(n);
      opt.textContent = n === 1 ? '1 Guest' : `${n} Guests`;
      if (extra > 0) {
        opt.textContent += `  (+${formatInr(extra * p.extraGuestRateInr)}/night)`;
      }
      el.guestCount.appendChild(opt);
    }
    el.guestCount.value = String(Math.min(previous, p.maxGuests));
  }

  /** True when [checkIn, checkOut) collides with any held stay. */
  function overlapsBooked(checkIn, checkOut) {
    return state.booked.some((b) => checkIn < b.checkOut && checkOut > b.checkIn);
  }

  /** First check-in on or after `from` that leaves `nights` free. */
  function nextFreeWindow(from, nights) {
    for (let i = 0; i < 365; i++) {
      const start = addDays(from, i);
      const end = addDays(start, nights);
      if (!overlapsBooked(start, end)) return { checkIn: start, checkOut: end };
    }
    return null;
  }

  // -------------------------------------------------------------------------
  // Quote
  // -------------------------------------------------------------------------

  function currentQuote() {
    const p = state.property;
    const ci = el.checkInDate?.value;
    const co = el.checkOutDate?.value;
    if (!p || !ci || !co || co <= ci) return null;

    const nights = nightsBetween(ci, co);
    if (nights < p.minNights || nights > p.maxNights) return null;

    const guests = Number(el.guestCount?.value) || p.baseGuests;
    const extraGuests = Math.max(0, guests - p.baseGuests);
    const ratePerNight = p.baseRateInr + extraGuests * p.extraGuestRateInr;
    const subtotal = ratePerNight * nights;
    const tax = Math.round((subtotal * p.taxPercent) / 100);

    return { nights, guests, extraGuests, ratePerNight, subtotal, tax, total: subtotal + tax };
  }

  function onStayChange() {
    // Keep check-out strictly after check-in.
    if (el.checkInDate?.value) {
      const minOut = addDays(el.checkInDate.value, state.property?.minNights || 1);
      el.checkOutDate.min = minOut;
      if (el.checkOutDate.value && el.checkOutDate.value < minOut) {
        el.checkOutDate.value = minOut;
      }
    }
    clearError();
    refreshQuote();
  }

  function refreshQuote() {
    if (!isOnlineBookable() || !state.property) {
      hide(el.quotePanel);
      return;
    }

    const p = state.property;
    const ci = el.checkInDate?.value;
    const co = el.checkOutDate?.value;

    if (!ci || !co) {
      hideNote();
      hide(el.quotePanel);
      updateButtonLabel();
      return;
    }

    if (co <= ci) {
      showNote('warn', 'error_outline', 'Check-out must be after check-in.');
      hide(el.quotePanel);
      updateButtonLabel();
      return;
    }

    const nights = nightsBetween(ci, co);
    if (nights < p.minNights) {
      showNote('warn', 'error_outline', `This stay has a ${p.minNights}-night minimum.`);
      hide(el.quotePanel);
      updateButtonLabel();
      return;
    }
    if (nights > p.maxNights) {
      showNote('warn', 'error_outline',
        `For stays longer than ${p.maxNights} nights, please contact us directly.`);
      hide(el.quotePanel);
      updateButtonLabel();
      return;
    }

    if (overlapsBooked(ci, co)) {
      const alt = nextFreeWindow(ci, nights);
      const suggestion = alt
        ? ` Next ${nights}-night opening: <button type="button" class="note-link" ` +
          `data-ci="${alt.checkIn}" data-co="${alt.checkOut}">` +
          `${formatRange(alt.checkIn, alt.checkOut)}</button>.`
        : '';
      showNote('warn', 'event_busy',
        `<strong>Those nights are already booked.</strong>${suggestion}`);
      wireSuggestion();
      hide(el.quotePanel);
      updateButtonLabel();
      return;
    }

    showNote('ok', 'event_available',
      `<strong>Available.</strong> ${formatRange(ci, co)} · ${nights} night${nights > 1 ? 's' : ''}.`);
    renderQuote(currentQuote());
    updateButtonLabel();
  }

  function renderQuote(q) {
    if (!q || !el.quotePanel) return;
    const p = state.property;

    const rows = [
      [`${formatInr(p.baseRateInr)} × ${q.nights} night${q.nights > 1 ? 's' : ''}`,
       formatInr(p.baseRateInr * q.nights)],
    ];
    if (q.extraGuests > 0) {
      rows.push([
        `Extra guest${q.extraGuests > 1 ? 's' : ''} (${q.extraGuests}) × ${q.nights} night${q.nights > 1 ? 's' : ''}`,
        formatInr(q.extraGuests * p.extraGuestRateInr * q.nights),
      ]);
    }
    rows.push([`GST (${p.taxPercent}%)`, formatInr(q.tax)]);

    el.quoteRows.innerHTML = rows.map(([label, value]) => (
      `<div class="quote-row"><span>${label}</span><span>${value}</span></div>`
    )).join('');

    el.quoteTotal.textContent = formatInr(q.total);
    show(el.quotePanel);
  }

  function updateButtonLabel() {
    if (el.submitBtn && isBookingTabActive() && !state.submitting) {
      el.submitBtn.textContent = nextActionLabel();
    }
  }

  function wireSuggestion() {
    el.availabilityNote?.querySelector('.note-link')?.addEventListener('click', (e) => {
      el.checkInDate.value = e.currentTarget.dataset.ci;
      el.checkOutDate.value = e.currentTarget.dataset.co;
      refreshQuote();
    });
  }

  // -------------------------------------------------------------------------
  // Submit → Razorpay → confirm
  // -------------------------------------------------------------------------

  async function submit() {
    if (state.submitting) return;
    clearError();

    if (typeof window.Razorpay !== 'function') {
      showError('The payment library could not load. Please check your connection and reload the page.');
      return;
    }

    const name = el.name?.value.trim() || '';
    const phone = el.contact?.value.trim() || '';
    const email = el.email?.value.trim() || '';
    const checkIn = el.checkInDate?.value || '';
    const checkOut = el.checkOutDate?.value || '';
    const guests = Number(el.guestCount?.value) || 0;

    if (name.length < 2) return showError('Please enter your full name.');
    if (phone.replace(/\D/g, '').length < 8) return showError('Please enter a valid contact number.');
    if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email)) {
      return showError('Please enter a valid email address — your confirmation goes there.');
    }
    if (!checkIn || !checkOut) return showError('Please choose your check-in and check-out dates.');
    if (checkOut <= checkIn) return showError('Check-out must be after check-in.');
    if (overlapsBooked(checkIn, checkOut)) return showError('Those nights are already booked. Please pick different dates.');
    if (!currentQuote()) return showError('Please choose valid dates for your stay.');

    setBusy(true, 'Reserving your dates…');

    let order;
    try {
      const res = await fetch(API.createOrder, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          property: el.stayDestination.value,
          checkIn, checkOut, guests,
          name, email, phone,
          notes: el.guestNotes?.value.trim() || '',
        }),
      });
      order = await res.json();

      if (!res.ok) {
        // Someone else took the dates while this guest was filling the form.
        if (order.error === 'dates_unavailable') {
          await loadAvailability();
          refreshQuote();
        }
        setBusy(false);
        return showError(order.message || 'We could not start your booking. Please try again.');
      }
    } catch (err) {
      console.error('create-order failed:', err);
      setBusy(false);
      return showError('We could not reach our booking service. Please check your connection and try again.');
    }

    setBusy(true, 'Opening secure payment…');
    openCheckout(order);
  }

  function openCheckout(order) {
    const rzp = new window.Razorpay({
      key: order.razorpayKeyId,
      order_id: order.orderId,
      amount: order.amountPaise,
      currency: 'INR',
      name: 'Celestia Inn LLP',
      description: `${order.property.name} · ${formatRange(order.stay.checkIn, order.stay.checkOut)}`,
      image: 'assets/images/the_higher_plane.jpg',
      prefill: {
        name: order.guest.name,
        email: order.guest.email,
        contact: order.guest.phone,
      },
      notes: { reference: order.reference },
      theme: { color: '#e9c176', backdrop_color: '#161412' },
      modal: {
        ondismiss: () => {
          setBusy(false);
          showNote('warn', 'info',
            `<strong>Payment not completed.</strong> Your dates are held as ` +
            `<strong>${order.reference}</strong> for a short while — submit again to confirm them.`);
        },
      },
      handler: (response) => confirmPayment(response, order),
    });

    rzp.on('payment.failed', (response) => {
      setBusy(false);
      const reason = response?.error?.description || 'The payment did not go through.';
      showError(`${reason} No money was taken. Please try again or use a different method.`);
    });

    rzp.open();
  }

  async function confirmPayment(response, order) {
    setBusy(true, 'Confirming your booking…');
    try {
      const res = await fetch(API.verify, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          razorpay_order_id: response.razorpay_order_id,
          razorpay_payment_id: response.razorpay_payment_id,
          razorpay_signature: response.razorpay_signature,
        }),
      });
      const data = await res.json();

      if (!res.ok) throw new Error(data.message || 'verification failed');

      showSuccess(data, order);
    } catch (err) {
      console.error('Payment verification failed:', err);
      // Money may well have been captured — the webhook is the backstop, so
      // never tell the guest the payment failed here.
      setBusy(false);
      showError(
        `Your payment went through but we could not show the confirmation. ` +
        `Your booking reference is ${order.reference} and payment id ` +
        `${response.razorpay_payment_id}. Please save these and contact us — ` +
        `do not pay again.`,
      );
    } finally {
      await loadAvailability({ silent: true });
    }
  }

  function showSuccess(data, order) {
    setBusy(false);
    state.submitting = false;

    if (el.successOverlayTitle) el.successOverlayTitle.textContent = 'Your Stay Is Confirmed';
    if (el.successOverlayDesc) {
      el.successOverlayDesc.textContent =
        `Thank you, ${data.guestName.split(' ')[0]}. Your reservation is confirmed and paid in full. ` +
        `A confirmation is on its way to ${data.guestEmail}.`;
    }

    if (el.successDetails) {
      el.successDetails.innerHTML = `
        <div class="confirm-ref">
          <span class="confirm-ref-label">Booking Reference</span>
          <span class="confirm-ref-value">${escapeHtml(data.reference)}</span>
        </div>
        <div class="confirm-grid">
          ${confirmCell('Stay', order.property.name)}
          ${confirmCell('Check-in', formatLongDate(data.checkIn))}
          ${confirmCell('Check-out', formatLongDate(data.checkOut))}
          ${confirmCell('Nights', String(data.nights))}
          ${confirmCell('Guests', String(data.guests))}
          ${confirmCell('Paid', formatInr(data.amountPaidInr))}
        </div>`;
      show(el.successDetails);
    }

    if (el.resetFormBtn) el.resetFormBtn.textContent = 'Book Another Stay';
    el.successOverlay?.classList.add('active');

    clearError();
    hideNote();
    hide(el.quotePanel);
    ['email', 'checkInDate', 'checkOutDate', 'guestNotes'].forEach((k) => {
      if (el[k]) el[k].value = '';
    });
    if (el.name) el.name.value = '';
    if (el.contact) el.contact.value = '';
  }

  function confirmCell(label, value) {
    return `<div class="confirm-cell">
      <span class="confirm-cell-label">${label}</span>
      <span class="confirm-cell-value">${escapeHtml(value)}</span>
    </div>`;
  }

  function resetAfterSuccess() {
    hide(el.successDetails);
    if (el.successDetails) el.successDetails.innerHTML = '';
    syncMode();
  }

  // -------------------------------------------------------------------------
  // UI helpers
  // -------------------------------------------------------------------------

  function setBusy(busy, label) {
    state.submitting = busy;
    if (!el.submitBtn) return;

    el.submitBtn.disabled = busy;
    if (busy) {
      el.submitBtn.innerHTML =
        `<span class="btn-busy"><svg class="spinner" width="16" height="16" viewBox="0 0 50 50">` +
        `<circle cx="25" cy="25" r="20" fill="none" stroke="currentColor" stroke-width="5" ` +
        `stroke-linecap="round" stroke-dasharray="80,200"></circle></svg>` +
        `${escapeHtml(label || 'Working…')}</span>`;
    } else {
      el.submitBtn.textContent = nextActionLabel();
    }
  }

  function showError(msg) {
    if (!el.formError) return;
    el.formError.innerHTML =
      `<span class="material-symbols-outlined">error</span><div>${msg}</div>`;
    show(el.formError);
    el.formError.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function clearError() { hide(el.formError); }

  function showNote(kind, icon, html) {
    if (!el.availabilityNote) return;
    el.availabilityNote.className = `availability-note note-${kind}`;
    el.availabilityNote.innerHTML =
      `<span class="material-symbols-outlined">${icon}</span><div>${html}</div>`;
    show(el.availabilityNote);
  }

  function hideNote() { hide(el.availabilityNote); }
  function show(n) { if (n) n.hidden = false; }
  function hide(n) { if (n) n.hidden = true; }

  // -------------------------------------------------------------------------
  // Pure helpers — dates are YYYY-MM-DD strings throughout, never Date objects,
  // so nothing shifts a day across timezones.
  // -------------------------------------------------------------------------

  function isoToday() {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date());
  }

  function parts(d) { const [y, m, day] = d.split('-').map(Number); return [y, m - 1, day]; }

  function addDays(d, n) {
    const [y, m, day] = parts(d);
    return new Date(Date.UTC(y, m, day + n)).toISOString().slice(0, 10);
  }

  function nightsBetween(a, b) {
    const [ay, am, ad] = parts(a); const [by, bm, bd] = parts(b);
    return Math.round((Date.UTC(by, bm, bd) - Date.UTC(ay, am, ad)) / 86400000);
  }

  function formatInr(n) { return `₹${Number(n).toLocaleString('en-IN')}`; }

  function formatLongDate(d) {
    const [y, m, day] = parts(d);
    return new Date(Date.UTC(y, m, day)).toLocaleDateString('en-IN', {
      weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
    });
  }

  function formatRange(a, b) {
    const [ay, am, ad] = parts(a); const [by, bm, bd] = parts(b);
    const f = (y, m, d, withYear) => new Date(Date.UTC(y, m, d)).toLocaleDateString('en-IN', {
      day: 'numeric', month: 'short', ...(withYear ? { year: 'numeric' } : {}), timeZone: 'UTC',
    });
    return `${f(ay, am, ad, ay !== by)} – ${f(by, bm, bd, true)}`;
  }

  function camel(id) { return id.replace(/-([a-z])/g, (_, c) => c.toUpperCase()); }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }
})();
