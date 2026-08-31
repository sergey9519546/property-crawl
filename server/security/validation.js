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
}

module.exports = Validator;
