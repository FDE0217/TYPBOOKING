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

  const base = {
    origin,
    destination: dest,
    unique: 'false',
    sorting: 'price',
    direct: 'false',
    currency: 'usd',
    limit: '10',
    page: '1',
  };
  const attempts = [
    { departure_at: date, ...(back ? { return_at: back, one_way: 'false' } : { one_way: 'true' }), exact: true },
    { departure_at: date.slice(0, 7), one_way: 'true', exact: false },
    { departure_at: date.slice(0, 7), one_way: 'false', exact: false },
  ];

  try {
    for (const a of attempts) {
      const { exact, ...extra } = a;
      const params = new URLSearchParams({ ...base, ...extra });
      const res = await fetch('https://api.travelpayouts.com/aviasales/v3/prices_for_dates?' + params, {
        headers: { 'X-Access-Token': token },
      });
      if (!res.ok) return json(502, { error: 'Price service error (' + res.status + ').' });
      const data = await res.json();
      const offers = (data.data || []).filter((o) => o && o.price > 0);
      if (!offers.length) continue;

      const best = offers.sort((x, y) => x.price - y.price)[0];
      const total = best.price * guests;
      return json(200, {
        source: 'Travelpayouts',
        environment: exact ? 'cached from-price' : 'cached from-price, nearby dates',
        totalUSD: total,
        flight: { total, airline: best.airline || '', date: best.departure_at || '', link: best.link || '' },
        hotel: null,
      });
    }
    return json(404, { error: 'No prices found for this search.' });
  } catch (err) {
    return json(502, { error: err.message });
  }
};
