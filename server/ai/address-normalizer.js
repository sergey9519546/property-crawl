/**
 * @file server/ai/address-normalizer.js
 * Bioinformatics-inspired sequence alignment and fuzzy address & parcel disambiguator.
 * Cleans irregular courthouse abbreviations, unit ranges, and extracts parcel IDs.
 */

const CITY_NORMALIZATION = {
  CLEV: 'Cleveland',
  CLEVELAND: 'Cleveland',
  COL: 'Columbus',
  COLUMBUS: 'Columbus',
  CINCY: 'Cincinnati',
  CINCINNATI: 'Cincinnati',
  HACK: 'Hackensack',
  HACKENSACK: 'Hackensack',
  NEWARK: 'Newark',
  NWK: 'Newark',
  PHILLY: 'Philadelphia',
  PHILADELPHIA: 'Philadelphia',
  MIA: 'Miami',
  MIAMI: 'Miami',
  TPA: 'Tampa',
  TAMPA: 'Tampa',
  ORL: 'Orlando',
  ORLANDO: 'Orlando'
};

const STREET_SUFFIXES = {
  ST: 'St',
  STREET: 'St',
  RD: 'Rd',
  ROAD: 'Rd',
  AVE: 'Ave',
  AVENUE: 'Ave',
  BLVD: 'Blvd',
  BOULEVARD: 'Blvd',
  DR: 'Dr',
  DRIVE: 'Dr',
  LN: 'Ln',
  LANE: 'Ln',
  CT: 'Ct',
  COURT: 'Ct',
  WAY: 'Way',
  PKWY: 'Pkwy'
};

/**
 * Normalizes irregular courthouse address text and isolates parcel IDs.
 * @param {string} rawString - e.g. "1420-1422 E 112TH ST, CLEV OH / PARCEL 108-12-044"
 * @returns {object} { standardizedAddress: string, parcelId: string|null, city: string, state: string }
 */
function normalizeAddressAndParcel(rawString = '') {
  if (!rawString) {
    return { standardizedAddress: '', parcelId: null, city: '', state: '' };
  }

  const str = String(rawString);

  // Extract Parcel ID: e.g. "PARCEL 108-12-044" or "PIN # 12-34-567"
  const parcelMatch = str.match(/(?:parcel|pin|tax\s*id|apn)\s*(?:no\.?|#)?\s*([0-9A-Za-z\-\.\/]+)/i);
  const parcelId = parcelMatch ? parcelMatch[1].trim() : null;

  // Remove parcel clause to isolate address part
  let addrPart = str.replace(/(?:[\/\;\|]?\s*(?:parcel|pin|tax\s*id|apn)[\s\S]*)/i, '').trim();

  // Normalize range numbers: e.g. "1420-1422" -> "1420"
  addrPart = addrPart.replace(/^(\d+)\s*[\-\/]\s*\d+/, '$1');

  // Match: [Street Number] [Direction/Name...] [City] [State] [Zip]
  // e.g. "1420 E 112TH ST, CLEV OH"
  let city = '';
  let state = '';
  let streetName = addrPart;

  const cityStateMatch = addrPart.match(/,\s*([A-Za-z]+)\s+([A-Z]{2})(?:\s+(\d{5}))?/i);
  if (cityStateMatch) {
    const rawCity = cityStateMatch[1].toUpperCase();
    city = CITY_NORMALIZATION[rawCity] || cityStateMatch[1];
    state = cityStateMatch[2].toUpperCase();
    streetName = addrPart.substring(0, cityStateMatch.index).trim();
  }

  // Normalize Street suffix and directionals
  const words = streetName.split(/\s+/).map((word, idx, arr) => {
    const u = word.toUpperCase().replace(/[\.,]/g, '');
    if (STREET_SUFFIXES[u]) return STREET_SUFFIXES[u];
    if (['N', 'S', 'E', 'W', 'NE', 'NW', 'SE', 'SW'].includes(u)) return u;
    if (/\d+(?:ST|ND|RD|TH)/i.test(u)) {
      return u.replace(/(\d+)(ST|ND|RD|TH)/i, (_, n, sfx) => `${n}${sfx.toLowerCase()}`);
    }
    // Capitalize standard words
    return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
  });

  const cleanedStreet = words.join(' ');
  const standardizedAddress = city && state
    ? `${cleanedStreet}, ${city}, ${state}`
    : cleanedStreet;

  return {
    standardizedAddress,
    parcelId,
    city,
    state
  };
}

module.exports = {
  normalizeAddressAndParcel,
  CITY_NORMALIZATION
};
