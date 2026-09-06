'use strict';

const { discoveryReadiness } = require('../server/discovery-readiness');

// The script is deliberately fail-closed for advanced mode. It only checks
// configuration here; the API route should inject the live DB probe.
discoveryReadiness().then((result) => {
  console.log(JSON.stringify(result, null, 2));
  if (!result.ready) process.exitCode = 1;
});
