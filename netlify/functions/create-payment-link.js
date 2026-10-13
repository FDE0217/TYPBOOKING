// Staff-only: creates a PayMongo payment link for a confirmed booking.
// Env vars: PAYMONGO_SECRET_KEY, STAFF_KEY
const json = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body)
});

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' });

  const staffKey = process.env.STAFF_KEY;
  const secret = process.env.PAYMONGO_SECRET_KEY;
  if (!staffKey || !secret) return json(503, { error: 'Payments not configured. Set STAFF_KEY and PAYMONGO_SECRET_KEY in Netlify.' });
  if (event.headers['x-staff-key'] !== staffKey) return json(401, { error: 'Wrong staff key.' });

  let data;
  try { data = JSON.parse(event.body || '{}'); } catch (e) { return json(400, { error: 'Bad JSON' }); }

  const amountPHP = Number(data.amountPHP);
  if (!(amountPHP >= 100)) return json(400, { error: 'Amount must be at least PHP 100.' });
  const reference = String(data.reference || '').slice(0, 40);

  const res = await fetch('https://api.paymongo.com/v1/links', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Basic ' + Buffer.from(secret + ':').toString('base64')
    },
    body: JSON.stringify({
      data: {
        attributes: {
          amount: Math.round(amountPHP * 100),
          description: `TYP Explore Travel & Tours ${reference}`.trim(),
          remarks: reference
        }
      }
    })
  });

  const out = await res.json().catch(() => ({}));
  if (!res.ok) return json(502, { error: 'PayMongo error', detail: out.errors || out });
  return json(200, { url: out.data.attributes.checkout_url, reference });
};
