// Cheapest flight price via the Travelpayouts (Aviasales) Data API.
// Required Netlify env var: TRAVELPAYOUTS_TOKEN
// These are cached "from" prices found by recent searches, not a bookable live quote.

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

exports.handler = async (event) => {
  const token = process.env.TRAVELPAYOUTS_TOKEN;
  if (!token) return json(503, { error: 'Live pricing is not configured.' });

  const q = event.queryStringParameters || {};
  const mode = q.mode;
  const origin = (q.origin || '').toUpperCase();
  const dest = (q.dest || '').toUpperCase();
  const date = /^\d{4}-\d{2}-\d{2}$/.test(q.checkin || '') ? q.checkin : '';
  const back = /^\d{4}-\d{2}-\d{2}$/.test(q.checkout || '') ? q.checkout : '';
  const guests = Math.max(1, parseInt(q.guests, 10) || 1);

  if (mode !== 'flights' && mode !== 'snap') {
    return json(404, { error: 'Live prices are only available for flights.' });
  }
  if (!/^[A-Z]{3}$/.test(origin) || !/^[A-Z]{3}$/.test(dest) || !date) {
    return json(400, { error: 'Missing airport codes or date.' });
  }

  const params = new URLSearchParams({
    origin,
    destination: dest,
    departure_at: date,
    one_way: back ? 'false' : 'true',
    unique: 'false',
    sorting: 'price',
    direct: 'false',
    currency: 'usd',
    limit: '10',
    page: '1',
  });
  if (back) params.set('return_at', back);

  try {
    const res = await fetch('https://api.travelpayouts.com/aviasales/v3/prices_for_dates?' + params, {
      headers: { 'X-Access-Token': token },
    });
    if (!res.ok) return json(502, { error: 'Price service error (' + res.status + ').' });
    const data = await res.json();
    const offers = (data.data || []).filter((o) => o && o.price > 0);
    if (!offers.length) return json(404, { error: 'No prices found for this search.' });

    const best = offers.sort((a, b) => a.price - b.price)[0];
    const total = best.price * guests;
    return json(200, {
      source: 'Travelpayouts',
      environment: 'cached from-price',
      totalUSD: total,
      flight: { total, airline: best.airline || '', link: best.link || '' },
      hotel: null,
    });
  } catch (err) {
    return json(502, { error: err.message });
  }
};
