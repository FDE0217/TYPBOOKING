// Staff-only: creates a Maya Checkout payment link for a confirmed booking.
// Env vars: MAYA_PUBLIC_KEY, STAFF_KEY (optional MAYA_ENV=sandbox for testing)
const json = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body)
});

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' });

  const staffKey = process.env.STAFF_KEY;
  const secret = process.env.MAYA_PUBLIC_KEY;
  if (!staffKey || !secret) return json(503, { error: 'Payments not configured. Set STAFF_KEY and MAYA_PUBLIC_KEY in Netlify.' });
  if (event.headers['x-staff-key'] !== staffKey) return json(401, { error: 'Wrong staff key.' });

  let data;
  try { data = JSON.parse(event.body || '{}'); } catch (e) { return json(400, { error: 'Bad JSON' }); }

  const amountPHP = Number(data.amountPHP);
  if (!(amountPHP >= 100)) return json(400, { error: 'Amount must be at least PHP 100.' });
  const reference = String(data.reference || '').slice(0, 40);

  const host = process.env.MAYA_ENV === 'sandbox' ? 'https://pg-sandbox.paymaya.com' : 'https://pg.maya.ph';
  const site = process.env.URL || 'https://typbooking.netlify.app';
  const amount = Math.round(amountPHP * 100) / 100;
  const description = `TYP Explore Travel & Tours ${reference}`.trim();

  const res = await fetch(host + '/checkout/v1/checkouts', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Basic ' + Buffer.from(secret + ':').toString('base64')
    },
    body: JSON.stringify({
      totalAmount: { value: amount, currency: 'PHP' },
      items: [{
        name: description.slice(0, 255),
        quantity: 1,
        totalAmount: { value: amount }
      }],
      requestReferenceNumber: reference || 'TYP-' + Date.now(),
      redirectUrl: { success: site, failure: site, cancel: site }
    })
  });

  const out = await res.json().catch(() => ({}));
  if (!res.ok || !out.redirectUrl) return json(502, { error: 'Maya error', detail: out });
  return json(200, { url: out.redirectUrl, reference });
};
