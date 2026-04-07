const https = require('https');
const http = require('http');

const SPECIALTIES = [
  { label: "Orthopedic Surgery",  query: "Orthopaedic Surgery" },
  { label: "Neurosurgery",        query: "Neurosurgery" },
  { label: "General Surgery",     query: "General Surgery" },
  { label: "Ophthalmology",       query: "Ophthalmology" },
  { label: "ENT",                 query: "Otolaryngology" },
  { label: "Urology",             query: "Urology" },
  { label: "Gastroenterology",    query: "Gastroenterology" },
  { label: "Pain Management",     query: "Pain Medicine" },
  { label: "Plastic Surgery",     query: "Plastic Surgery" },
];

function fetchNPPES(state, taxonomy) {
  return new Promise((resolve) => {
    const url = `https://npiregistry.cms.hhs.gov/api/?version=2.1&enumeration_type=NPI-1&state=${encodeURIComponent(state)}&taxonomy_description=${encodeURIComponent(taxonomy)}&limit=200&skip=0`;
    https.get(url, { headers: { 'User-Agent': 'NPI-Tracker/1.0' } }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data).results || []); }
        catch(e) { resolve([]); }
      });
    }).on('error', () => resolve([]));
  });
}

function ageDays(dateStr) {
  if (!dateStr) return 9999;
  return Math.floor((Date.now() - new Date(dateStr)) / 86400000);
}

function parseRecord(p, specLabel) {
  const basic = p.basic || {};
  const addrs = p.addresses || [];
  const addr = addrs.find(a => a.address_purpose === 'LOCATION') || addrs[0] || {};
  const days = ageDays(basic.enumeration_date);
  return {
    name: `${basic.first_name||''} ${basic.last_name||''}`.trim(),
    credential: basic.credential || '',
    specialty: specLabel,
    city: addr.city || '',
    zip: (addr.postal_code||'').slice(0,5),
    phone: addr.telephone_number || '',
    enrolledDate: basic.enumeration_date || '',
    days,
    npi: p.number || '',
    gender: basic.gender || '',
    bucket: days<=30 ? 'New (<30d)' : days<=90 ? 'Recent (30-90d)' : days<=180 ? '6 months' : '>6 months'
  };
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === '/health') {
    res.writeHead(200, {'Content-Type':'application/json'});
    res.end(JSON.stringify({status:'ok'}));
    return;
  }

  if (url.pathname === '/search') {
    const state   = (url.searchParams.get('state') || 'UT').toUpperCase().trim();
    const days    = parseInt(url.searchParams.get('days') || '180');
    const specQ   = url.searchParams.get('specialty') || 'all';

    const specsToFetch = specQ === 'all' ? SPECIALTIES
      : SPECIALTIES.filter(s => s.query === specQ);

    const seen = new Set();
    let results = [];

    for (const spec of specsToFetch) {
      const raw = await fetchNPPES(state, spec.query);
      for (const r of raw) {
        if (!seen.has(r.number)) {
          seen.add(r.number);
          const rec = parseRecord(r, spec.label);
          if (rec.days <= days) results.push(rec);
        }
      }
    }

    results.sort((a,b) => a.days - b.days);

    res.writeHead(200, {'Content-Type':'application/json'});
    res.end(JSON.stringify({ count: results.length, state, days, results }));
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`NPI Tracker server running on port ${PORT}`));
