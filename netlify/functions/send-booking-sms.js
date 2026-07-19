// SwingFirst — Twilio SMS confirmation sender
// Netlify Function: /.netlify/functions/send-booking-sms
// No npm packages — uses native fetch (Node 18+) with Twilio REST API

exports.handler = async (event) => {
  const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS, body: 'Method Not Allowed' };
  }

  const accountSid  = process.env.TWILIO_ACCOUNT_SID;
  const authToken   = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber  = process.env.TWILIO_FROM_NUMBER;

  if (!accountSid || !authToken || !fromNumber) {
    console.error('Twilio env vars not configured');
    return {
      statusCode: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'SMS service not configured.' }),
    };
  }

  let to, email, ref, courseName, coursePhone, timeStr, players, totalFormatted;
  try {
    ({ to, email, ref, courseName, coursePhone, timeStr, players, totalFormatted } = JSON.parse(event.body));
  } catch (e) {
    return {
      statusCode: 400,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Invalid request body.' }),
    };
  }

  // Normalize phone to E.164 — strips everything except digits, prepends +1
  function toE164(raw) {
    const digits = raw.replace(/\D/g, '');
    if (digits.length === 10) return '+1' + digits;
    if (digits.length === 11 && digits.startsWith('1')) return '+' + digits;
    return null;
  }

  const toNumber = toE164(to || '');
  if (!toNumber) {
    return {
      statusCode: 400,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Invalid phone number.' }),
    };
  }

  const checkinUrl = `https://book.swingfirst.ai/checkin.html?ref=${encodeURIComponent(ref)}`;
  const cancelUrl  = `https://book.swingfirst.ai/cancel.html?ref=${encodeURIComponent(ref)}`;
  const lookupUrl  = email
    ? `https://book.swingfirst.ai/lookup.html?ref=${encodeURIComponent(ref)}&email=${encodeURIComponent(email)}`
    : `https://book.swingfirst.ai/lookup.html?ref=${encodeURIComponent(ref)}`;

  const body =
    `⛳ SwingFirst confirmed! ${courseName} · ${timeStr} · ` +
    `${players} player${players !== 1 ? 's' : ''} · ${totalFormatted}.\n` +
    `Check-in QR: ${checkinUrl}\n` +
    `Manage booking: ${lookupUrl}\n` +
    `Cancel: ${cancelUrl}\n` +
    `Questions? ${coursePhone}`;

  const params = new URLSearchParams({ To: toNumber, From: fromNumber, Body: body });
  const credentials = Buffer.from(`${accountSid}:${authToken}`).toString('base64');

  try {
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${credentials}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params.toString(),
      }
    );

    const data = await res.json();

    if (!res.ok) {
      console.error('Twilio error:', data);
      return {
        statusCode: res.status,
        headers: { ...CORS, 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: data.message || 'Twilio error.' }),
      };
    }

    return {
      statusCode: 200,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true, sid: data.sid }),
    };

  } catch (err) {
    console.error('SMS function error:', err);
    return {
      statusCode: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'SMS service unavailable.' }),
    };
  }
};
