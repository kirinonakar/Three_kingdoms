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
    if(!siege) appearances.add(JSON.stringify(g.style));
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
    // Independently sample every dry-to-dry step: no invisible crossing may remain.
    for(const [xx,yy] of land.filter(([x,y])=>t[y][x]<4)) {
      for(const [nx,ny] of [[xx+1,yy],[xx,yy+1]]) {
        if(nx>=13||ny>=9||t[ny][nx]>=4) continue;
        const a={x:xx,y:yy},b={x:nx,y:ny};
        const wet=Array.from({length:199},(_,i)=>(i+1)/200).some(f=>g.rivers.concat(g.lakes)
          .some(r=>geo.inside(xx+.5+(nx-xx)*f,yy+.5+(ny-yy)*f,r.polygon)));
        const marked=g.edgeFords.some(c=>c.from.x===xx&&c.from.y===yy&&c.to.x===nx&&c.to.y===ny);
        assert.equal(marked,geo.waterBetween(g,a,b),name+': unmarked edge ford');
        if(wet) assert(marked,name+': visible stream has an invisible crossing');
        assert.equal(geo.waterBetween(g,a,b),geo.waterBetween(g,b,a),name+': asymmetric water barrier');
      }
    }
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
    } else {
      signatures.add(JSON.stringify(t));
      const castle=geo.build({name,x,y},true);
      const differences=t.flat().filter((v,i)=>v!==(castle.terrain.flat()[i]===3?0:castle.terrain.flat()[i])).length;
      assert(differences>=15,name+': field must differ from siege beyond removing castles ('+differences+')');
      assert(g.site&&g.tactics&&g.kind!=='siege',name+': missing field identity/tactics');
    }
    assert.equal(JSON.stringify(g),JSON.stringify(geo.build({name,x,y},siege)),name+': terrain changes on regeneration');
  }
}
assert.equal(signatures.size,30,'regional terrain must differ for every city');
assert.equal(appearances.size,30,'cities must not share an identical vegetation/material/surface profile');
// Every approach must retain usable connected land, water-matching tiles and an explicit river crossing.
for(const [name] of cities) {
  const views=new Set();
  for(const x of [-1,0,1]) for(const y of [-1,0,1]) {
    const g=geo.build({name},false,{x,y}),t=g.terrain;
    views.add(JSON.stringify(t));
    assert.equal(g.crossings.length,g.rivers.length,name+': approach lost a river crossing');
    const land=t.flatMap((row,y)=>row.map((v,x)=>({v,x,y}))).filter(c=>c.v!==4);
    const queue=[land[0]],seen=new Set([land[0].y*13+land[0].x]);
    for(let i=0;i<queue.length;i++) {
      const p=queue[i];
      for(const [nx,ny] of [[p.x-1,p.y],[p.x+1,p.y],[p.x,p.y-1],[p.x,p.y+1]]) {
        if(nx<0||ny<0||nx>=13||ny>=9||t[ny][nx]===4||seen.has(ny*13+nx))continue;
        seen.add(ny*13+nx);queue.push({x:nx,y:ny});
      }
    }
    assert.equal(seen.size,land.length,name+': approach strands a unit deployment area');
    t.forEach((row,y)=>row.forEach((v,x)=>assert.equal(v>=4,g.rivers.concat(g.lakes).some(r=>geo.inside(x+.5,y+.5,r.polygon)),name+': approach water mismatch')));
    assert.equal(JSON.stringify(g),JSON.stringify(geo.build({name},false,{x,y})),name+': approach is not reproducible');
  }
  assert.equal(views.size,9,name+': approach must change the outlying battlefield');
}
const hz=geo.build({name:'한중'},true);
assert(hz.terrain[0].filter(v=>v===2).length>=8,'Hanzhong: northern Qinling missing');
assert(hz.terrain[8].filter(v=>v===2).length>=8,'Hanzhong: southern Daba missing');
const hf=geo.build({name:'합비'},true);
assert(hf.terrain[8][12]===4,'Hefei: southeastern Chao lake missing');
assert(hf.terrain[0][0]!==4,'Hefei: northwestern plain flooded');
const cd=geo.build({name:'성도'},true);
assert(cd.terrain.flat().filter(v=>v===0).length>40,'Chengdu: alluvial plain lost');
const yn=geo.build({name:'여남'},true);
for(const x of [6,7,8]) assert(yn.edgeFords.some(c=>c.from.x===x&&c.from.y===4&&c.to.x===x&&c.to.y===5),'여수: narrow crossing missing at '+x);
// A channel thinner than a sampling interval must still block melee; a tangent must not.
const thin={rivers:[{polygon:[[.701,0],[.702,0],[.702,2],[.701,2]]}],lakes:[]};
assert(geo.waterBetween(thin,{x:0,y:0},{x:1,y:0}),'sub-pixel channel missed');
assert(!geo.waterBetween(thin,{x:0,y:2},{x:1,y:2}),'same-bank path blocked');
assert(!geo.waterBetween({rivers:[],lakes:[{polygon:[[1,.5],[.8,0],[1.2,0]]}]},{x:0,y:0},{x:1,y:0}),'shoreline tangent blocked');
console.log('[OK] 30 cities × field/siege: marked sub-tile crossings, exact water barriers, bank-to-bank fords, connected land, matching banks, separate castles, reproducible geography');
