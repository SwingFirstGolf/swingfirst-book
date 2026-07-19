// SwingFirst — 24-hour tee time reminder sender
// Netlify Scheduled Function: runs at 7 pm MST (02:00 UTC)
// Queries Supabase for tomorrow's bookings and sends SMS + email reminders.
//
// Skip logic: if the booking was created AFTER 4 pm on the day before the
// tee time (i.e., same day we would fire this reminder), the golfer booked
// very recently and doesn't need a reminder.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY; // service role key for server-side reads
const BASE_URL     = process.env.SITE_URL || 'https://book.swingfirst.ai';

// ── Helpers ───────────────────────────────────────────────────────────────────

function toE164(raw) {
  const digits = (raw || '').replace(/\D/g, '');
  if (digits.length === 10) return '+1' + digits;
  if (digits.length === 11 && digits.startsWith('1')) return '+' + digits;
  return null;
}

function fmt12(hour, minute) {
  const h = hour % 12 || 12;
  const m = String(minute).padStart(2, '0');
  return `${h}:${m} ${hour < 12 ? 'AM' : 'PM'}`;
}

function pad(n) { return String(n || 0).padStart(2, '0'); }

// ── Supabase query ────────────────────────────────────────────────────────────

async function fetchTomorrowBookings(tomorrowStr) {
  const url = `${SUPABASE_URL}/rest/v1/bookings` +
    `?select=id,lead_name,lead_email,lead_phone,booking_ref,player_count,total_cents,comm_pref,created_at,` +
    `tee_times!inner(date,hour,minute,courses(name,phone))` +
    `&tee_times.date=eq.${tomorrowStr}` +
    `&status=neq.cancelled` +
    `&order=tee_times.hour.asc,tee_times.minute.asc`;

  const res = await fetch(url, {
    headers: {
      apikey:        SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase query failed: ${res.status} — ${text}`);
  }
  return res.json();
}

// ── SMS ───────────────────────────────────────────────────────────────────────

async function sendSms(phone, body) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken  = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_FROM_NUMBER;
  if (!accountSid || !authToken || !fromNumber) throw new Error('Twilio not configured');

  const toNumber = toE164(phone);
  if (!toNumber) throw new Error(`Bad phone: ${phone}`);

  const params = new URLSearchParams({ To: toNumber, From: fromNumber, Body: body });
  const creds  = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
  const res    = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
    {
      method:  'POST',
      headers: { Authorization: `Basic ${creds}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    params.toString(),
    }
  );
  const data = await res.json();
  if (!res.ok) throw new Error(`Twilio: ${data.message}`);
  return data.sid;
}

// ── Email ─────────────────────────────────────────────────────────────────────

async function sendEmail(to, firstName, ref, courseName, coursePhone, timeStr, players, totalFormatted, date, hour, minute) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error('Resend not configured');

  const checkinUrl = `${BASE_URL}/checkin.html?ref=${encodeURIComponent(ref)}`;
  const manageUrl  = `${BASE_URL}/lookup.html?ref=${encodeURIComponent(ref)}&email=${encodeURIComponent(to)}`;
  const cancelUrl  = `${BASE_URL}/cancel.html?ref=${encodeURIComponent(ref)}`;
  const qrSrc      = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(ref)}&bgcolor=f2f9f5&color=0b3d2e&margin=0`;

  const ds      = (date || '').replace(/-/g, '');
  const startDt = `${ds}T${pad(hour)}${pad(minute)}00`;
  const endDt   = `${ds}T${pad(Math.min(hour + 4, 23))}${pad(minute)}00`;
  const calUrl  = `https://www.google.com/calendar/render?action=TEMPLATE` +
    `&text=${encodeURIComponent('⛳ Tee Time — ' + courseName)}` +
    `&dates=${startDt}/${endDt}` +
    `&details=${encodeURIComponent('SwingFirst ref: ' + ref + '\nCheck in: ' + checkinUrl)}` +
    `&location=${encodeURIComponent(courseName)}` +
    `&ctz=America%2FPhoenix`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="margin:0;padding:0;background:#f2f9f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
  <div style="max-width:480px;margin:40px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08);">
    <div style="background:#0b3d2e;padding:28px;text-align:center;">
      <div style="font-size:28px;margin-bottom:8px;">⛳</div>
      <div style="color:#fff;font-size:22px;font-weight:800;letter-spacing:-.02em;">Tee time tomorrow!</div>
      <div style="color:rgba(255,255,255,.6);font-size:12px;margin-top:4px;text-transform:uppercase;letter-spacing:.06em;">SwingFirst Reminder</div>
    </div>
    <div style="padding:24px 28px 0;font-size:15px;color:#0d1f17;">
      Hi ${firstName || 'there'},<br/><br/>
      Just a reminder — you have a tee time tomorrow at <strong>${courseName}</strong>.
    </div>
    <div style="margin:20px 24px;border:1px solid #e4e9e6;border-radius:12px;overflow:hidden;">
      <table style="width:100%;border-collapse:collapse;font-size:14px;">
        <tr style="border-bottom:1px solid #e4e9e6;">
          <td style="padding:12px 18px;color:#6b7a72;">Course</td>
          <td style="padding:12px 18px;font-weight:600;text-align:right;">${courseName}</td>
        </tr>
        <tr style="border-bottom:1px solid #e4e9e6;">
          <td style="padding:12px 18px;color:#6b7a72;">Tee Time</td>
          <td style="padding:12px 18px;font-weight:700;text-align:right;font-size:16px;color:#0b3d2e;">${timeStr}</td>
        </tr>
        <tr>
          <td style="padding:12px 18px;color:#6b7a72;">Players</td>
          <td style="padding:12px 18px;font-weight:600;text-align:right;">${players} player${players !== 1 ? 's' : ''}</td>
        </tr>
      </table>
    </div>
    <div style="margin:0 24px;text-align:center;">
      <div style="font-size:11px;color:#6b7a72;font-weight:700;text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px;">Your Check-In QR Code</div>
      <a href="${checkinUrl}"><img src="${qrSrc}" width="160" height="160" alt="QR" style="display:block;margin:0 auto;border-radius:8px;border:2px solid #a8d5bc;"/></a>
      <div style="font-size:12px;color:#6b7a72;margin-top:8px;">Show this at the cart desk to check in</div>
    </div>
    <div style="margin:20px 24px;display:flex;gap:10px;flex-wrap:wrap;justify-content:center;">
      <a href="${calUrl}" target="_blank" style="display:inline-block;padding:10px 20px;background:#0b3d2e;color:#fff;font-size:13px;font-weight:700;text-decoration:none;border-radius:8px;">📅 Add to Calendar</a>
      <a href="${manageUrl}" style="display:inline-block;padding:10px 20px;background:#f2f9f5;color:#1b6b4f;font-size:13px;font-weight:700;text-decoration:none;border-radius:8px;border:1.5px solid #a8d5bc;">📋 Manage Booking</a>
    </div>
    <div style="padding:16px 28px 24px;text-align:center;border-top:1px solid #e4e9e6;margin-top:12px;">
      <div style="font-size:11px;color:#6b7a72;line-height:1.8;">
        Ref: <strong>${ref}</strong> · Questions? <a href="tel:${(coursePhone||'').replace(/\D/g,'')}" style="color:#1b6b4f;">${coursePhone}</a><br/>
        Need to cancel? <a href="${cancelUrl}" style="color:#9A2A42;font-weight:600;">Cancel this booking →</a>
      </div>
    </div>
  </div>
</body>
</html>`;

  const res = await fetch('https://api.resend.com/emails', {
    method:  'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify({
      from:    'SwingFirst <bookings@swingfirst.ai>',
      to:      [to],
      subject: `⛳ Reminder: tee time tomorrow at ${courseName} — ${timeStr}`,
      html,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Resend: ${data.message}`);
  return data.id;
}

// ── Handler ───────────────────────────────────────────────────────────────────

exports.handler = async () => {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('SUPABASE_URL / SUPABASE_SERVICE_KEY not set');
    return { statusCode: 500, body: 'Supabase not configured' };
  }

  // "Today" in Phoenix time (MST/MDT) — JS dates are UTC, so we add offset
  // Phoenix is UTC-7 (no daylight saving). At 7 pm local = 02:00 UTC next calendar day.
  // We treat "today" as the day this reminder fires (local date), "tomorrow" is +1.
  const nowUTC   = new Date();
  // Phoenix offset: UTC-7
  const phxOffset = -7 * 60;
  const phxMs    = nowUTC.getTime() + (phxOffset - (-nowUTC.getTimezoneOffset())) * 60000;
  // Simpler: just offset by -7h
  const phxNow   = new Date(nowUTC.getTime() + phxOffset * 60000);
  const todayStr = phxNow.toISOString().slice(0, 10);           // YYYY-MM-DD today in PHX
  const tomorrowDate = new Date(phxNow);
  tomorrowDate.setUTCDate(tomorrowDate.getUTCDate() + 1);
  const tomorrowStr = tomorrowDate.toISOString().slice(0, 10);  // YYYY-MM-DD tomorrow in PHX

  // 4 pm today (local) as ISO for comparison with booking created_at
  // created_at is stored as UTC in Supabase; 4 pm PHX = 23:00 UTC
  const cutoffUTC = new Date(`${todayStr}T23:00:00Z`); // 4 pm PHX = 23:00 UTC

  console.log(`Reminder job: today=${todayStr}, tomorrow=${tomorrowStr}, cutoff=${cutoffUTC.toISOString()}`);

  let bookings;
  try {
    bookings = await fetchTomorrowBookings(tomorrowStr);
  } catch (err) {
    console.error('fetchTomorrowBookings error:', err.message);
    return { statusCode: 500, body: `DB error: ${err.message}` };
  }

  console.log(`Found ${bookings.length} booking(s) for ${tomorrowStr}`);

  const results = [];

  for (const b of bookings) {
    const createdAt  = new Date(b.created_at);
    const commPref   = b.comm_pref || 'both';

    // Skip if booked AFTER 4pm today (they just booked it, no reminder needed)
    if (createdAt >= cutoffUTC) {
      console.log(`Skipping ${b.booking_ref} — booked after 4pm cutoff (${createdAt.toISOString()})`);
      results.push({ ref: b.booking_ref, skipped: true, reason: 'booked-after-cutoff' });
      continue;
    }

    if (commPref === 'none') {
      results.push({ ref: b.booking_ref, skipped: true, reason: 'comm_pref=none' });
      continue;
    }

    const tt         = b.tee_times || {};
    const course     = tt.courses  || {};
    const courseName = course.name || 'the course';
    const coursePhone= course.phone || '';
    const timeStr    = fmt12(tt.hour, tt.minute);
    const total      = b.total_cents ? `$${Math.round(b.total_cents / 100)}` : '';
    const firstName  = (b.lead_name || '').split(' ')[0] || b.lead_name || '';
    const ref        = b.booking_ref;

    const sent = { ref, sms: null, email: null, error: null };

    // SMS
    if ((commPref === 'sms' || commPref === 'both') && b.lead_phone) {
      try {
        const checkinUrl = `${BASE_URL}/checkin.html?ref=${encodeURIComponent(ref)}`;
        const manageUrl  = b.lead_email
          ? `${BASE_URL}/lookup.html?ref=${encodeURIComponent(ref)}&email=${encodeURIComponent(b.lead_email)}`
          : `${BASE_URL}/lookup.html?ref=${encodeURIComponent(ref)}`;
        const smsBody =
          `⛳ Reminder: tee time tomorrow at ${courseName} · ${timeStr}` +
          (b.player_count > 1 ? ` · ${b.player_count} players` : '') + `.\n` +
          `Check in: ${checkinUrl}\n` +
          `Manage: ${manageUrl}`;
        sent.sms = await sendSms(b.lead_phone, smsBody);
      } catch (e) {
        sent.error = (sent.error ? sent.error + '; ' : '') + `SMS: ${e.message}`;
      }
    }

    // Email
    if ((commPref === 'email' || commPref === 'both') && b.lead_email) {
      try {
        sent.email = await sendEmail(
          b.lead_email, firstName, ref, courseName, coursePhone,
          timeStr, b.player_count, total, tt.date, tt.hour, tt.minute
        );
      } catch (e) {
        sent.error = (sent.error ? sent.error + '; ' : '') + `Email: ${e.message}`;
      }
    }

    console.log(`Reminder ${ref}:`, JSON.stringify(sent));
    results.push(sent);
  }

  const sentCount    = results.filter(r => !r.skipped).length;
  const skippedCount = results.filter(r => r.skipped).length;
  console.log(`Done — ${sentCount} sent, ${skippedCount} skipped.`);

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tomorrow: tomorrowStr, sent: sentCount, skipped: skippedCount, results }),
  };
};
