// SwingFirst — Self-serve booking cancellation
// Netlify Function: /.netlify/functions/cancel-booking
// Validates 24h window server-side, triggers Stripe refund, marks booking cancelled.

const SUPABASE_URL = 'https://ojgxfeaesnaohskxdvam.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || 'sb_publishable_4UVFMXQWGOt4XNgHVNzWoQ_Id6TBqcu';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const JSON_CORS = { ...CORS, 'Content-Type': 'application/json' };

function respond(statusCode, body) {
  return { statusCode, headers: JSON_CORS, body: JSON.stringify(body) };
}

async function sbPatch(path, data) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: 'PATCH',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal',
    },
    body: JSON.stringify(data),
  });
}

async function stripeRefund(paymentIntentId) {
  const r = await fetch('https://api.stripe.com/v1/refunds', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ payment_intent: paymentIntentId }).toString(),
  });
  return r.json();
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return respond(405, { error: 'Method not allowed.' });

  let bookingRef;
  try {
    ({ bookingRef } = JSON.parse(event.body || '{}'));
  } catch {
    return respond(400, { error: 'Invalid request.' });
  }

  if (!bookingRef || typeof bookingRef !== 'string') {
    return respond(400, { error: 'Booking reference is required.' });
  }

  const sbH = {
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
  };

  // ── 1. Fetch booking with tee time ──────────────────────────────
  const lookupUrl = `${SUPABASE_URL}/rest/v1/bookings`
    + `?booking_ref=eq.${encodeURIComponent(bookingRef.toUpperCase())}`
    + `&select=id,lead_name,player_count,total_cents,status,stripe_payment_intent,tee_times(date,hour,minute)`;

  const lookupRes = await fetch(lookupUrl, { headers: sbH });
  const rows = await lookupRes.json();

  if (!Array.isArray(rows) || rows.length === 0) {
    return respond(404, { error: 'Booking not found. Please check your reference number.' });
  }

  const booking = rows[0];
  const tt = booking.tee_times;

  // ── 2. Status checks ────────────────────────────────────────────
  if (booking.status === 'cancelled') {
    return respond(409, { error: 'This booking has already been cancelled.' });
  }
  if (booking.status === 'checked_in') {
    return respond(409, { error: 'This booking has been checked in and can no longer be cancelled online. Please speak with the pro shop.' });
  }

  // ── 3. 24-hour window check (server-side) ────────────────────────
  // Phoenix is permanently UTC-7 (no DST)
  if (!tt) {
    return respond(500, { error: 'Could not verify tee time. Please contact the pro shop.' });
  }
  const [yr, mo, dy] = tt.date.split('-').map(Number);
  const teeUTC  = new Date(Date.UTC(yr, mo - 1, dy, tt.hour + 7, tt.minute));
  const nowUTC  = new Date();
  const msUntil = teeUTC - nowUTC;
  const hrsUntil = msUntil / 3_600_000;

  if (hrsUntil <= 24) {
    const hrs = Math.max(0, Math.floor(hrsUntil));
    const mins = Math.max(0, Math.floor((hrsUntil - hrs) * 60));
    return respond(400, {
      error: 'cancellation_window_passed',
      message: `The 24-hour cancellation window has passed (tee time in ${hrs}h ${mins}m). Please contact the pro shop for assistance.`,
    });
  }

  // ── 4. Stripe refund (paid bookings only) ───────────────────────
  let refundId = null;
  const wasPaidOnline = !!booking.stripe_payment_intent;

  if (wasPaidOnline) {
    const refund = await stripeRefund(booking.stripe_payment_intent);
    if (refund.error) {
      console.error('Stripe refund error:', refund.error);
      return respond(500, { error: 'Refund could not be processed: ' + refund.error.message + '. Please contact the pro shop.' });
    }
    refundId = refund.id;
  }

  // ── 5. Mark booking cancelled ───────────────────────────────────
  const patch = await sbPatch(`bookings?id=eq.${booking.id}`, { status: 'cancelled' });
  if (!patch.ok) {
    return respond(500, { error: 'Could not update booking status. Please contact the pro shop.' });
  }

  // ── 6. Cancel booking_players (fire-and-forget) ─────────────────
  sbPatch(`booking_players?booking_id=eq.${booking.id}`, { status: 'cancelled' }).catch(() => {});

  return respond(200, {
    success: true,
    refunded: wasPaidOnline,
    refundId,
    totalCents: booking.total_cents,
    leadName: booking.lead_name,
    playerCount: booking.player_count,
  });
};
