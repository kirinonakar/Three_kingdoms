'use strict';
// Slower statistical regression for the two requested siege-defense targets.
const {spawnSync}=require('node:child_process'),path=require('node:path'),assert=require('node:assert/strict');
const trials=process.argv.find(a=>a.startsWith('--trials='))||'--trials=128';
const seed=process.argv.find(a=>a.startsWith('--seed='))||'--seed=731';
const cities=process.argv.find(a=>a.startsWith('--cities='))||'--cities=낙양,한중,합비';
const rows=[];
for(const [defense,ratios] of [[50,'1'],[100,'1.3,1.35,1.4']]) {
  const result=spawnSync(process.execPath,[path.join(__dirname,'balance_test.js'),'--simulate-only','--json','--siege-only',trials,seed,cities,'--defense='+defense,'--ratios='+ratios],{encoding:'utf8'});
  assert.equal(result.status,0,(result.stdout||'')+(result.stderr||'')+(result.error||''));
  rows.push(...JSON.parse(result.stdout));
}
function rate(list) {
  const counts=list.map(row=>row.attackerWins.split('/').map(Number));
  const wins=counts.reduce((sum,c)=>sum+c[0],0),total=counts.reduce((sum,c)=>sum+c[1],0);
  return {wins,total,rate:wins/total};
}
const low=rate(rows.filter(r=>r.defense===50)),high=rate(rows.filter(r=>r.defense===100));
const middle=rate(rows.filter(r=>r.defense===100&&r.ratio===1.35));
const summary=[{defense:50,ratio:1,...low}];
for(const ratio of [1.3,1.35,1.4])summary.push({defense:100,ratio,...rate(rows.filter(r=>r.defense===100&&r.ratio===ratio))});
summary.push({defense:100,ratio:'1.3–1.4 combined',...high});
console.table(summary.map(r=>({...r,rate:(r.rate*100).toFixed(1)+'%'})));
assert(low.rate>=.45&&low.rate<=.55,'defense 50 / equal army should be approximately 50%');
assert(high.rate>=.55&&high.rate<=.65,'defense 100 / 1.3–1.4 army should be approximately 60%');
assert(middle.rate>=.55&&middle.rate<=.65,'defense 100 / central 1.35 army should be approximately 60%');
console.log('[OK] fixed-composition siege targets; city-dependent variation is retained. '+trials+' '+seed+' '+cities);
