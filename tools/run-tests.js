'use strict';
const {spawnSync}=require('node:child_process'),path=require('node:path');
const tests=['smoke','save','battle','terrain','map_territory','campaign','deployment','balance','tactical_ai','economy','battle_supply','alliance','strategy','field_campaign','automation','ai_balance','portrait','custom_officers','hire'];
let failed=0;
for(const name of tests) {
  const result=spawnSync(process.execPath,[path.join(__dirname,name+'_test.js')],{encoding:'utf8'});
  if(result.status===0)console.log('[PASS] '+name);
  else {failed++;console.error('[FAIL] '+name+'\n'+(result.stdout||'')+(result.stderr||'')+(result.error||''));}
}
console.log(`${tests.length-failed}/${tests.length} logic suites passed. Browser and audio checks: npm run test:browser / test:audio.`);
process.exitCode=failed?1:0;
