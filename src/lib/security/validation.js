class Validator {
  static validateListing(data) {
    const errors = [];
    if (!data.address || typeof data.address !== 'string') errors.push('Address is required');
    if (!data.city || typeof data.city !== 'string') errors.push('City is required');
    if (!data.state || typeof data.state !== 'string' || data.state.length !== 2) errors.push('Valid 2-letter state is required');
    if (data.openingBid == null || isNaN(Number(data.openingBid)) || Number(data.openingBid) < 0) errors.push('Valid openingBid is required');
    if (data.estLow == null || isNaN(Number(data.estLow))) errors.push('Valid estLow is required');
    if (data.estHigh == null || isNaN(Number(data.estHigh))) errors.push('Valid estHigh is required');
    if (!data.saleDate || isNaN(new Date(data.saleDate).getTime())) errors.push('Valid saleDate (YYYY-MM-DD) is required');

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  static validateNoticeInput(text) {
    if (!text || typeof text !== 'string' || text.trim().length < 10) {
      return { isValid: false, error: 'Notice text must be at least 10 characters long' };
    }
    if (text.length > 50000) {
      return { isValid: false, error: 'Notice text exceeds maximum size limit (50,000 characters)' };
    }
    return { isValid: true };
  }

  /**
   * Strict integer parser for query-string parameters.
   * Returns { ok: true, value } on success or { ok: false, error } on failure.
   * Rejects: null, '', non-numeric, NaN, Infinity, out-of-range, non-integer.
   */
  static strictIntParam(raw, field, defaultValue, min, max) {
    if (raw === null || raw === undefined || raw === '') {
      return { ok: true, value: defaultValue };
    }
    // Reject anything that isn't a clean integer literal (no hex, no scientific,
    // no whitespace, no leading + on signed values, no partial matches like "5abc").
    if (typeof raw !== 'string' && typeof raw !== 'number') {
      return { ok: false, error: `Parameter "${field}" must be a string or number` };
    }
    const str = String(raw).trim();
    if (str === '') return { ok: true, value: defaultValue };
    if (!/^-?\d+$/.test(str)) {
      return { ok: false, error: `Parameter "${field}" must be a base-10 integer (got "${raw}")` };
    }
    const n = Number(str);
    if (!Number.isFinite(n) || !Number.isInteger(n)) {
      return { ok: false, error: `Parameter "${field}" must be a finite integer` };
    }
    if (n < min || n > max) {
      return { ok: false, error: `Parameter "${field}" must be between ${min} and ${max} (got ${n})` };
    }
    return { ok: true, value: n };
  }

  /**
   * Strict bounded-string validator for query parameters.
   * Returns the (possibly empty) string on success, or null on failure.
   */
  static boundedStringParam(raw, field, maxLen) {
    if (raw === null || raw === undefined) return { ok: true, value: '' };
    if (typeof raw !== 'string') {
      return { ok: false, error: `Parameter "${field}" must be a string` };
    }
    if (raw.length > maxLen) {
      return { ok: false, error: `Parameter "${field}" exceeds maximum length of ${maxLen} characters (got ${raw.length})` };
    }
    return { ok: true, value: raw };
  }

  /**
   * Strip control characters (other than space) from a string.
   * Defends against log-injection, terminal-escape sequences, and
   * smuggling of NULs / newlines into downstream consumers.
   */
  static stripControlChars(s) {
    if (typeof s !== 'string') return '';
    // eslint-disable-next-line no-control-regex
    return s.replace(/[\u0000-\u001f\u007f]/g, '');
  }
}

module.exports = Validator;
