'use strict';
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const assert = require('node:assert/strict');
const root = path.join(__dirname, '..'), sandbox = {};
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(['data.js', 'game.js'].map(f => fs.readFileSync(path.join(root, 'js', f), 'utf8')).join('\n') +
  '\nthis.regions = mapTerritories(); this.cities = CITY_DEFS; this.project = projMap;', sandbox);

function inside(point, polygon) {
  let hit = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if ((a[1] > point[1]) !== (b[1] > point[1]) &&
        point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) hit = !hit;
  }
  return hit;
}
function ownersAt(point) {
  return Array.from(sandbox.regions.filter(r => inside(point, r.pts)), r => r.name);
}
for (const [name, x, y] of sandbox.cities) {
  assert.deepEqual(ownersAt([x, y]), [name], name + ': city must stay in its own territory');
}
for (const [lon, lat] of [[118.5, 37], [119.8, 37.2], [120.8, 37.3], [122, 37.2], [120, 36.4]]) {
  assert.deepEqual(ownersAt(sandbox.project(lon, lat)), ['평원'], 'Shandong: ' + lon + ',' + lat);
}
for (const [name, lon, lat] of [['북평', 119.4, 40.3], ['남피', 116.9, 38.3], ['하비', 118.7, 34.7]]) {
  assert.deepEqual(ownersAt(sandbox.project(lon, lat)), [name], name + ': nearby mainland territory changed');
}
// Shared boundaries must match exactly even between two cells assigned to the same city.
for (const region of sandbox.regions) {
  for (const edge of region.edges) {
    if (!edge.neighbor) continue;
    const reverse = sandbox.regions.filter(r => r.name === edge.neighbor).flatMap(r => r.edges)
      .find(e => e.neighbor === region.name &&
        JSON.stringify(e.pts) === JSON.stringify(Array.from(edge.pts).reverse()));
    assert(reverse, region.name + ' / ' + edge.neighbor + ': mismatched boundary');
  }
}
console.log('[OK] Shandong belongs to Pingyuan; 30 city sites, nearby mainland, and shared boundaries preserved');
