'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const root = path.join(__dirname, '..'), sandbox = {};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(root, 'js/data.js'), 'utf8') + '\n' +
  fs.readFileSync(path.join(root, 'js/battle-terrain.js'), 'utf8') + '\nthis.geo=BattleTerrain; this.cities=CITY_DEFS;', sandbox);
const {geo,cities} = sandbox, signatures = new Set(), appearances = new Set();
for(const [name,x,y] of cities) {
  assert(geo.profiles[name], name + ': missing regional profile');
  for(const siege of [false,true]) {
    const g=geo.build({name,x,y},siege), t=g.terrain;
    appearances.add(JSON.stringify(g.style));
    for(const field of g.fields) {
      assert.equal(field.pts.length,12,name+': field must follow an organic outline');
      assert(field.pts.every(p=>p[0]>0&&p[0]<13&&p[1]>0&&p[1]<9),name+': field outside battlefield');
      assert(g.rivers.concat(g.lakes).every(r=>!geo.inside(field.x,field.y,r.polygon)),name+': field planted in water');
    }
    assert.equal(t.length,9);
    const forts=[], land=[];
    for(let yy=0;yy<9;yy++) {
      assert.equal(t[yy].length,13);
      for(let xx=0;xx<13;xx++) {
        const v=t[yy][xx];assert(v>=0&&v<=5,name+': invalid terrain');
        if(v!==4) land.push([xx,yy]);
        if(v===3) forts.push([xx,yy]);
        const renderedWater=g.rivers.concat(g.lakes).some(r=>geo.inside(xx+.5,yy+.5,r.polygon));
        assert.equal(v===4||v===5,renderedWater,name+': visual/passability mismatch at '+xx+','+yy);
      }
    }
    const q=[land[0]], seen=new Set([land[0].join(',')]);
    for(let i=0;i<q.length;i++) {
      const [xx,yy]=q[i];
      for(const [nx,ny] of [[xx-1,yy],[xx+1,yy],[xx,yy-1],[xx,yy+1]]) {
        const k=nx+','+ny;
        if(nx>=0&&ny>=0&&nx<13&&ny<9&&t[ny][nx]!==4&&!seen.has(k)){seen.add(k);q.push([nx,ny]);}
      }
    }
    assert.equal(seen.size,land.length,name+': stranded land/fort');
    assert.equal(g.crossings.length,g.rivers.length,name+': missing river crossing');
    for (const river of g.rivers) {
      const crossing=g.crossings.find(c=>c.river===river.name);
      assert(crossing&&crossing.cells.length,name+': '+river.name+' has no ford');
      assert(t[crossing.from.y][crossing.from.x]<4&&t[crossing.to.y][crossing.to.x]<4,name+': crossing must reach dry banks');
      const path=[crossing.from,...crossing.cells,crossing.to];
      path.forEach((p,i)=>{
        assert(t[p.y][p.x]!==4,name+': blocked ford path');
        if(i) assert.equal(Math.abs(p.x-path[i-1].x)+Math.abs(p.y-path[i-1].y),1,name+': disconnected ford');
      });
      assert(crossing.cells.every(p=>t[p.y][p.x]===5),name+': incomplete ford');
      assert(crossing.cells.some(p=>geo.inside(p.x+.5,p.y+.5,river.polygon)),name+': ford misses its river');
    }
    assert.equal(forts.length,siege?3:0,name+': castle count');
    forts.forEach((a,i)=>forts.slice(i+1).forEach(b=>assert(Math.max(Math.abs(a[0]-b[0]),Math.abs(a[1]-b[1]))>=3,name+': castles touch')));
    if(siege) {
      assert(forts.every(f=>f[0]>=6&&f[0]<=10),name+': castles must leave six columns on the left and avoid the right edge');
      assert(Math.max(...forts.map(f=>f[0]))-Math.min(...forts.map(f=>f[0]))>=2,name+': castles concentrated in one column');
      assert(Math.max(...forts.map(f=>f[1]))-Math.min(...forts.map(f=>f[1]))>=3,name+': castles concentrated in one row');
    } else signatures.add(JSON.stringify(t));
    assert.equal(JSON.stringify(g),JSON.stringify(geo.build({name,x,y},siege)),name+': terrain changes on regeneration');
  }
}
assert.equal(signatures.size,30,'regional terrain must differ for every city');
assert.equal(appearances.size,30,'cities must not share an identical vegetation/material/surface profile');
const hz=geo.build({name:'한중'},false);
assert(hz.terrain[0].filter(v=>v===2).length>=8,'Hanzhong: northern Qinling missing');
assert(hz.terrain[8].filter(v=>v===2).length>=8,'Hanzhong: southern Daba missing');
const hf=geo.build({name:'합비'},false);
assert(hf.terrain[8][12]===4,'Hefei: southeastern Chao lake missing');
assert(hf.terrain[0][0]!==4,'Hefei: northwestern plain flooded');
const cd=geo.build({name:'성도'},false);
assert(cd.terrain.flat().filter(v=>v===0).length>40,'Chengdu: alluvial plain lost');
console.log('[OK] 30 cities × field/siege: bank-to-bank fords on every river, connected land, matching banks, separate distributed castles, reproducible geography');
