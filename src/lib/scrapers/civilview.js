// The backend scraper is canonical. Re-export it for the Next.js server
// runtime so CivilView fixes cannot drift between two copied modules.
module.exports = require('../../../server/scrapers/civilview');
