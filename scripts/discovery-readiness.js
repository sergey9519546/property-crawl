'use strict';
const {discoveryReadiness,probeDiscoveryDatabase}=require('../server/discovery-readiness');
async function main(){let pool;try{const result=await discoveryReadiness({databaseProbe:async()=>{const {Pool}=require('pg');pool=new Pool({connectionString:process.env.DATABASE_URL,max:1,connectionTimeoutMillis:5000});return probeDiscoveryDatabase(pool);}});console.log(JSON.stringify(result,null,2));if(!result.ready)process.exitCode=1;}finally{if(pool)await pool.end();}}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
