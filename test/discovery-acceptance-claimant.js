'use strict';
const { Pool } = require('pg');
const { createDiscoveryStore } = require('../server/discovery/store');
async function main(){const schema=process.env.DISCOVERY_TEST_SCHEMA;if(!/^[a-z0-9_]+$/i.test(schema||''))throw new Error(`Invalid test schema name: ${schema}`);const pool=new Pool({connectionString:process.env.DATABASE_URL,options:`-c search_path=${schema},public`,max:1});await pool.query(`SET search_path TO "${schema}", public`);const claimed=await createDiscoveryStore(pool).claimJob(process.env.DISCOVERY_TEST_JOB_ID,process.env.DISCOVERY_TEST_OWNER,10);if(process.send)process.send({claimed:Boolean(claimed)});if(!claimed){await pool.end();process.exit(2);}setInterval(()=>{},1000);}
main().catch(error=>{if(process.send)process.send({error:error.message});process.exit(1);});
