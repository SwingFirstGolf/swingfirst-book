// SwingFirst — POS receipt email via Resend
// Netlify Function: /.netlify/functions/send-pos-receipt
// Accepts: { to, items, totalCents, method, ref, courseName, cashierName }

exports.handler = async (event) => {
  const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: CORS, body: 'Method Not Allowed' };

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Email service not configured.' }),
    };
  }

  let to, items, totalCents, method, ref, courseName, cashierName;
  try {
    ({ to, items, totalCents, method, ref, courseName, cashierName } = JSON.parse(event.body));
    if (!to || !items || totalCents == null || !ref) throw new Error('Missing required fields');
  } catch (e) {
    return {
      statusCode: 400,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Invalid request: ' + e.message }),
    };
  }

  const fmt = (cents) => '$' + (cents / 100).toFixed(2);
  const methodLabel = { credit: 'Credit Card', debit: 'Debit Card', cash: 'Cash', zelle: 'Zelle', check: 'Check' }[method] || method;
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/Phoenix' });
  const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Phoenix' });
  const displayCourse = courseName || 'SwingFirst Pro Shop';

  const itemRows = (items || []).map(i => `
    <tr>
      <td style="padding:11px 18px;color:#0d1f17;font-size:14px;">${i.name}</td>
      <td style="padding:11px 18px;color:#6b7a72;font-size:14px;text-align:center;">×${i.qty}</td>
      <td style="padding:11px 18px;font-weight:600;font-size:14px;text-align:right;color:#0d1f17;">${fmt(i.price * i.qty)}</td>
    </tr>`).join('');

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="margin:0;padding:0;background:#f2f9f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
  <div style="max-width:480px;margin:40px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08);">

    <!-- Header -->
    <div style="background:#0b3d2e;padding:28px 32px;text-align:center;">
      <div style="font-size:28px;margin-bottom:8px;">⛳</div>
      <div style="color:#fff;font-size:22px;font-weight:800;letter-spacing:-.02em;">SwingFirst</div>
      <div style="color:rgba(255,255,255,.55);font-size:12px;margin-top:4px;letter-spacing:.06em;text-transform:uppercase;">Purchase Receipt</div>
    </div>

    <!-- Date + location -->
    <div style="padding:20px 32px 0;text-align:center;">
      <div style="font-size:13px;color:#6b7a72;font-weight:500;">${displayCourse}</div>
      <div style="font-size:13px;color:#6b7a72;margin-top:2px;">${dateStr} · ${timeStr} MST</div>
    </div>

    <!-- Ref -->
    <div style="padding:16px 32px;text-align:center;">
      <div style="display:inline-block;background:#f2f9f5;border:1.5px solid #a8d5bc;border-radius:8px;padding:8px 20px;">
        <span style="font-size:11px;color:#6b7a72;font-weight:700;text-transform:uppercase;letter-spacing:.08em;">Transaction · </span>
        <span style="font-size:14px;font-weight:700;color:#0b3d2e;letter-spacing:.04em;">${ref}</span>
      </div>
    </div>

    <!-- Items table -->
    <div style="margin:0 24px;">
      <table style="width:100%;border-collapse:collapse;border:1px solid #e4e9e6;border-radius:10px;overflow:hidden;">
        <thead>
          <tr style="background:#f8faf8;border-bottom:1px solid #e4e9e6;">
            <th style="padding:10px 18px;text-align:left;font-size:11px;color:#6b7a72;font-weight:700;text-transform:uppercase;letter-spacing:.06em;">Item</th>
            <th style="padding:10px 18px;text-align:center;font-size:11px;color:#6b7a72;font-weight:700;text-transform:uppercase;letter-spacing:.06em;">Qty</th>
            <th style="padding:10px 18px;text-align:right;font-size:11px;color:#6b7a72;font-weight:700;text-transform:uppercase;letter-spacing:.06em;">Price</th>
          </tr>
        </thead>
        <tbody>
          ${itemRows}
          <tr style="border-top:2px solid #e4e9e6;background:#f8faf8;">
            <td colspan="2" style="padding:14px 18px;font-weight:700;font-size:14px;color:#0d1f17;">Total</td>
            <td style="padding:14px 18px;font-weight:800;font-size:18px;text-align:right;color:#0b3d2e;">${fmt(totalCents)}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Payment method -->
    <div style="margin:16px 24px;background:#f2f9f5;border:1px solid #a8d5bc;border-radius:10px;padding:14px 18px;display:flex;justify-content:space-between;align-items:center;">
      <span style="font-size:13px;color:#6b7a72;font-weight:500;">Paid with</span>
      <span style="font-size:14px;font-weight:700;color:#0b3d2e;">${methodLabel}</span>
    </div>

    <!-- Footer -->
    <div style="padding:20px 32px;text-align:center;border-top:1px solid #e4e9e6;margin-top:8px;">
      <div style="font-size:11px;color:#6b7a72;line-height:1.8;">
        Thank you for visiting ${displayCourse}!<br/>
        SwingFirst · This is an automated receipt. Please do not reply.
      </div>
    </div>

  </div>
</body>
</html>`;

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from:    'SwingFirst <bookings@swingfirst.ai>',
        to:      [to],
        subject: `Your receipt from ${displayCourse} · ${ref}`,
        html,
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      console.error('Resend error:', data);
      return {
        statusCode: res.status,
        headers: { ...CORS, 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: data.message || 'Email send failed.' }),
      };
    }

    return {
      statusCode: 200,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true, id: data.id }),
    };

  } catch (err) {
    console.error('send-pos-receipt error:', err);
    return {
      statusCode: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Email service unavailable.' }),
    };
  }
};
