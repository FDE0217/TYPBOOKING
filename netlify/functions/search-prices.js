// Live price lookup via the Amadeus Self-Service API.
// Required Netlify env vars: AMADEUS_CLIENT_ID, AMADEUS_CLIENT_SECRET
// Optional: AMADEUS_ENV=production (defaults to the free test environment)

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

const baseUrl = () =>
  process.env.AMADEUS_ENV === 'production'
    ? 'https://api.amadeus.com'
    : 'https://test.api.amadeus.com';

async function getToken() {
  const res = await fetch(`${baseUrl()}/v1/security/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: process.env.AMADEUS_CLIENT_ID,
      client_secret: process.env.AMADEUS_CLIENT_SECRET,
    }),
  });
  if (!res.ok) throw new Error(`Amadeus auth failed (${res.status})`);
  return (await res.json()).access_token;
}

async function api(token, path, params) {
  const res = await fetch(`${baseUrl()}${path}?${new URLSearchParams(params)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Amadeus ${path} failed (${res.status})`);
  return res.json();
}

async function cheapestFlight(token, { origin, dest, checkin, checkout, guests }) {
  const params = {
    originLocationCode: origin,
    destinationLocationCode: dest,
    departureDate: checkin,
    adults: String(guests),
    currencyCode: 'USD',
    max: '10',
  };
  if (checkout) params.returnDate = checkout;
  const data = await api(token, '/v2/shopping/flight-offers', params);
  const offers = (data.data || []).map((o) => ({
    total: parseFloat(o.price.grandTotal),
    airline: (o.validatingAirlineCodes || [])[0] || '',
  }));
  if (!offers.length) return null;
  return offers.sort((a, b) => a.total - b.total)[0];
}

async function cheapestHotel(token, { dest, checkin, checkout, guests, rooms }) {
  const list = await api(token, '/v1/reference-data/locations/hotels/by-city', { cityCode: dest });
  const ids = (list.data || []).slice(0, 20).map((h) => h.hotelId);
  if (!ids.length) return null;
  const data = await api(token, '/v3/shopping/hotel-offers', {
    hotelIds: ids.join(','),
    adults: String(guests),
    roomQuantity: String(rooms),
    checkInDate: checkin,
    checkOutDate: checkout,
    currency: 'USD',
  });
  const offers = [];
  (data.data || []).forEach((h) => {
    (h.offers || []).forEach((o) =>
      offers.push({ total: parseFloat(o.price.total), name: h.hotel && h.hotel.name })
    );
  });
  if (!offers.length) return null;
  return offers.sort((a, b) => a.total - b.total)[0];
}

exports.handler = async (event) => {
  if (!process.env.AMADEUS_CLIENT_ID || !process.env.AMADEUS_CLIENT_SECRET) {
    return json(503, { error: 'Live pricing is not configured.' });
  }
  const q = event.queryStringParameters || {};
  const mode = q.mode;
  const input = {
    origin: (q.origin || '').toUpperCase(),
    dest: (q.dest || '').toUpperCase(),
    checkin: q.checkin,
    checkout: q.checkout,
    guests: Math.max(1, parseInt(q.guests, 10) || 1),
    rooms: Math.max(1, parseInt(q.rooms, 10) || 1),
  };
  if (!/^[A-Z]{3}$/.test(input.dest) || !input.checkin) {
    return json(400, { error: 'Missing destination code or date.' });
  }

  try {
    const token = await getToken();
    const wantFlight = mode === 'flights' || mode === 'snap';
    const wantHotel = mode === 'hotels' || mode === 'snap';
    if (wantFlight && !/^[A-Z]{3}$/.test(input.origin)) {
      return json(400, { error: 'Missing origin code.' });
    }
    if (wantHotel && !input.checkout) {
      return json(400, { error: 'Missing check-out date.' });
    }

    const [flight, hotel] = await Promise.all([
      wantFlight ? cheapestFlight(token, input).catch(() => null) : null,
      wantHotel ? cheapestHotel(token, input).catch(() => null) : null,
    ]);

    if ((wantFlight && !flight) || (wantHotel && !hotel)) {
      return json(404, { error: 'No live offers found for this search.' });
    }
    const totalUSD = (flight ? flight.total : 0) + (hotel ? hotel.total : 0);
    return json(200, {
      source: 'Amadeus',
      environment: process.env.AMADEUS_ENV === 'production' ? 'production' : 'test',
      totalUSD,
      flight,
      hotel,
    });
  } catch (err) {
    return json(502, { error: err.message });
  }
};
