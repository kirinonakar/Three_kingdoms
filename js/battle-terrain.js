/* 도시별 전술 지형. 북쪽이 위인 13×9 지역 약도이며 거리·강폭은 전술용으로 과장한다.
   현대의 댐·저수지·운하는 포함하지 않는다. 지리 근거와 축약 범위는 README 참고. */
const BattleTerrain = (function () {
  'use strict';
  const COLS = 13, ROWS = 9, WATER = 4, FORD = 5;
  const river = (name, w, pts) => ({ name, w, pts });
  const ridge = (name, w, pts) => ({ name, w, pts });
  const lake = (name, pts) => ({ name, pts });
  const profiles = {
    '무위': { region: '하서 회랑', detail: '남쪽 기련산 자락 · 북동쪽으로 흐르는 내륙 하천', theme: 'dry', woods: .12,
      rivers: [river('석양하 수계', .9, [[3,10],[4,7],[5,5],[7,3],[8,-1]])], ridges: [ridge('기련산', 2.7, [[-1,7],[2,8],[5,10]])] },
    '천수': { region: '위수 상류 계곡', detail: '동서로 열린 하곡 · 남북의 황토 구릉', theme: 'loess', woods: .2,
      rivers: [river('위수', 1, [[-1,5],[3,4.7],[6,5.3],[10,4.7],[14,5]])], ridges: [ridge('농산 자락', 2.2, [[-1,1],[4,.7],[9,1.3],[14,0]]),ridge('친링 자락', 2, [[-1,9],[5,8.6],[10,9]])] },
    '장안': { region: '관중 평야', detail: '북쪽 위수 · 남쪽 친링 · 넓은 충적 평야', theme: 'loess', woods: .12,
      rivers: [river('위수', 1.25, [[-1,2.1],[3,2.5],[7,1.8],[10,2.2],[14,1.4]])], ridges: [ridge('친링', 2.2, [[-1,9],[4,8.6],[8,9.1],[14,8.5]])] },
    '낙양': { region: '낙양 분지', detail: '북쪽 망산 · 분지를 가로지르는 낙수', theme: 'loess', woods: .18,
      rivers: [river('낙수', 1.05, [[-1,5.7],[3,5.3],[7,6],[10,5.7],[14,6.2]])], ridges: [ridge('망산', 2, [[-1,1],[4,1.2],[8,.6],[14,1.2]])] },
    '한중': { region: '한중 분지', detail: '북쪽 친링 · 남쪽 대파산 · 중앙 한수 하곡', theme: 'basin', woods: .32,
      rivers: [river('한수', 1.1, [[-1,5.2],[3,4.7],[6,5.3],[10,4.9],[14,5.6]])], ridges: [ridge('친링', 2.3, [[-1,.3],[4,.9],[8,.2],[14,.8]]),ridge('대파산', 2.1, [[-1,9],[5,8.5],[9,9.2],[14,8.4]])] },
    '상당': { region: '상당 고지', detail: '태항산 서쪽 고지 · 분지와 산간 통로', theme: 'upland', woods: .3,
      rivers: [river('탁장하', .85, [[3,-1],[4,2],[5,4],[8,5.5],[14,6]])], ridges: [ridge('태항산', 2.8, [[11,-1],[10,2],[11,5],[12,10]]),ridge('태악산', 1.6, [[0,-1],[.5,3],[-1,7]])] },
    '진양': { region: '태원 분지', detail: '남북으로 흐르는 분하 · 서쪽 여량산', theme: 'loess', woods: .18,
      rivers: [river('분하', 1, [[6,-1],[5.4,2],[6.1,5],[5.6,10]])], ridges: [ridge('여량산', 2.3, [[.2,-1],[1,3],[.4,6],[1,10]]),ridge('태항산 자락', 1.5, [[13,0],[12,4],[14,9]])] },
    '업': { region: '하북 평야 서연', detail: '남쪽 장하 · 서쪽 태항산에서 동쪽 평야로', theme: 'plain', woods: .12,
      rivers: [river('장하', 1.15, [[-1,7],[3,6.2],[7,6.8],[10,6.3],[14,7]])], ridges: [ridge('태항산 자락', 1.8, [[-1,-1],[.2,3],[-1,6]])] },
    '남피': { region: '하북 저평지', detail: '넓은 충적지 · 낮은 습지와 하천', theme: 'plain', woods: .1,
      rivers: [river('하북 하천', .9, [[-1,6.8],[3,6],[6,6.5],[9,5],[14,4.3]])], lakes: [lake('저지 습지', [[9,-1],[14,-1],[14,1.8],[12,2.3],[10.7,1.5]])] },
    '북평': { region: '연산 남록', detail: '북쪽 연산 · 남쪽으로 열린 평야와 난하', theme: 'upland', woods: .25,
      rivers: [river('난하', 1.05, [[9,-1],[8,2],[8.6,5],[10,7],[11,10]])], ridges: [ridge('연산', 2.4, [[-1,.3],[3,1],[7,.3],[14,.6]])] },
    '평원': { region: '황하 하류 평야', detail: '황하 유역의 완만한 범람원 · 낮은 둔치', theme: 'plain', woods: .12,
      rivers: [river('황하', 1.5, [[-1,7.7],[3,6.9],[6,6.2],[10,5.8],[14,4.6]])] },
    '진류': { region: '중원 충적 평야', detail: '평탄한 농경지 · 북쪽 황하의 범람원', theme: 'plain', woods: .1,
      rivers: [river('황하', 1.45, [[-1,1.6],[3,1.9],[7,1.3],[10,1.9],[14,1.3]])] },
    '복양': { region: '황하 도하 지대', detail: '북동쪽으로 흐르는 황하 · 넓은 하안 평지', theme: 'plain', woods: .14,
      rivers: [river('황하', 1.5, [[-1,6.9],[3,6.1],[6,5.5],[9,4.3],[14,3.1]])] },
    '허창': { region: '영수 평야', detail: '영수 수계의 농경지 · 서북쪽 구릉', theme: 'plain', woods: .14,
      rivers: [river('영수 수계', .9, [[1,-1],[3,2],[5,3.2],[8,5.2],[10,10]])], ridges: [ridge('숭산 자락', 1.6, [[-1,.4],[1,-.2],[4,-1]])] },
    '완': { region: '남양 분지', detail: '서북쪽 산지 · 남쪽으로 흐르는 백수', theme: 'basin', woods: .2,
      rivers: [river('백수', 1, [[7,-1],[7.5,2],[6.8,5],[8,7],[8.4,10]])], ridges: [ridge('복우산', 2, [[-1,2],[1,.6],[5,-1]])] },
    '소패': { region: '사수 평야', detail: '사수 유역의 평탄한 농경지 · 낮은 하천 둔치', theme: 'plain', woods: .14,
      rivers: [river('사수', 1.05, [[8,-1],[7.4,2],[8,5],[10,7],[11,10]])] },
    '하비': { region: '사수·기수 합류지', detail: '두 물길이 만나는 저지대 · 범람원', theme: 'wet', woods: .16,
      rivers: [river('사수', 1.25, [[5,-1],[5.7,2],[7,5.5],[9,10]]),river('기수', .95, [[14,2.2],[11,3],[9,4.6],[7,5.5]])] },
    '수춘': { region: '회수 남안', detail: '북쪽 회수 · 남쪽 구릉 사이의 평야', theme: 'wet', woods: .18,
      rivers: [river('회수', 1.45, [[-1,2.3],[3,1.8],[7,2.6],[11,2],[14,2.4]])], ridges: [ridge('팔공산', 1.4, [[0,6],[1,7.5],[3,9.5]])] },
    '합비': { region: '회수·장강 사이', detail: '비수의 남북 물길 · 동남쪽 소호', theme: 'wet', woods: .22,
      rivers: [river('비수', 1, [[5,-1],[5.7,2],[6.5,4],[8,6],[10,7]])], lakes: [lake('소호', [[9,5.9],[11,5.4],[14,5.8],[14,10],[7.5,10],[7.8,8],[8.5,7]])] },
    '여남': { region: '회수 상류 평야', detail: '여수의 완만한 물길 · 서쪽 낮은 구릉', theme: 'plain', woods: .15,
      rivers: [river('여수', .95, [[-1,3],[3,3.6],[6,4.9],[10,5.2],[14,6.7]])], ridges: [ridge('동백산 자락', 1.4, [[-1,7],[0,9],[3,10]])] },
    '양양': { region: '한수 중류', detail: '북쪽 한수 · 서남쪽 현산 자락', theme: 'basin', woods: .25,
      rivers: [river('한수', 1.5, [[-1,2.8],[3,2],[6,2.4],[10,3.5],[14,4.8]])], ridges: [ridge('현산', 1.9, [[-1,6],[2,7],[4,10]])] },
    '강하': { region: '장강·한수 합류지', detail: '큰 강의 합류부 · 동쪽 구릉과 충적지', theme: 'wet', woods: .22,
      rivers: [river('장강', 1.65, [[-1,8],[3,7.2],[6.5,5.6],[10,5.8],[14,7]]),river('한수', 1.15, [[-1,1],[2,2.7],[4,4.6],[6.5,5.6]])], ridges: [ridge('강하 구릉', 1.7, [[11,-1],[12,2],[14,3]])] },
    '강릉': { region: '강한 평야', detail: '남쪽 장강 · 북쪽의 넓고 낮은 평지', theme: 'wet', woods: .13,
      rivers: [river('장강', 1.65, [[-1,6.9],[3,6.2],[7,7.1],[10,6.4],[14,7]])] },
    '장사': { region: '상강 하곡', detail: '남북으로 흐르는 상강 · 양안의 낮은 구릉', theme: 'wet', woods: .34,
      rivers: [river('상강', 1.35, [[5,-1],[4.5,2],[5.6,5],[5,7],[5.5,10]])], ridges: [ridge('상강 동쪽 구릉', 1.8, [[12,-1],[11,3],[12,6],[14,9]])] },
    '건업': { region: '장강 남안', detail: '서북쪽 장강 · 동쪽 종산 · 진회수', theme: 'wet', woods: .26,
      rivers: [river('장강', 1.7, [[-1,6],[1,3.9],[3,2.5],[6,1.4],[10,-1]]),river('진회수', .75, [[14,6.7],[10,6],[6,5],[1,3.9]])], ridges: [ridge('종산', 1.8, [[10,2],[12,2.5],[14,3.8]])] },
    '오': { region: '태호 동쪽 수향', detail: '서쪽 태호 · 낮은 평지와 동쪽 물길', theme: 'wet', woods: .16,
      rivers: [river('오송강 수계', .9, [[3,5],[6,4.5],[9,5.2],[14,6.5]])], lakes: [lake('태호', [[-1,1],[1,1.3],[2.6,3],[3,5],[2,7.3],[-1,9]])] },
    '회계': { region: '절동 평야', detail: '북쪽 하안 저지 · 남쪽 회계산', theme: 'wet', woods: .35,
      rivers: [river('절강 하구', 1.5, [[-1,1],[3,1.6],[7,1.1],[10,.3],[14,-.3]])], ridges: [ridge('회계산', 2.5, [[-1,9],[4,7.7],[8,8.2],[14,7.1]])] },
    '성도': { region: '성도 평원', detail: '민강 수계의 부챗살 물길 · 동쪽 용천산', theme: 'basin', woods: .2,
      rivers: [river('민강 수계', 1, [[2,-1],[3,2],[4.6,4.5],[5,7],[6,10]]),river('분류 하천', .75, [[3,2],[6,3.3],[8,5],[9,10]])], ridges: [ridge('용천산', 1.5, [[12,-1],[11.8,4],[13,9]])] },
    '강주': { region: '파군의 합류 협곡', detail: '북쪽 가릉강과 서쪽 장강의 합류 · 산지', theme: 'gorge', woods: .36,
      rivers: [river('장강', 1.55, [[-1,6],[3,6.7],[7,5.2],[11,5.7],[14,7]]),river('가릉강', 1.1, [[4,-1],[3.4,2],[5,3.7],[7,5.2]])], ridges: [ridge('파군 북동 능선', 2.2, [[9,-1],[11,2],[14,3]]),ridge('파군 남쪽 능선', 1.7, [[-1,9],[4,8.6],[8,10]])] },
    '영안': { region: '삼협 서쪽 관문', detail: '장강 협곡 · 북쪽 대파산과 남쪽 산지', theme: 'gorge', woods: .4,
      rivers: [river('장강', 1.45, [[-1,5.7],[3,5.2],[6,5.9],[9,4.8],[14,5.5]])], ridges: [ridge('대파산·무산', 2.7, [[-1,.5],[3,1.4],[8,.9],[14,1.7]]),ridge('삼협 남쪽 산지', 2, [[-1,9],[5,8.7],[10,9.2],[14,8.3]])] }
  };
  const palettes = {
    dry: { ground: '#756a45', light: '#96865a', dark: '#514c34', field: '#a48b51', water: '#456766' },
    loess: { ground: '#696547', light: '#85805a', dark: '#494b36', field: '#b09a60', water: '#58736a' },
    plain: { ground: '#526449', light: '#71805b', dark: '#3a4c39', field: '#a39558', water: '#416c70' },
    basin: { ground: '#4e644b', light: '#718268', dark: '#354d3c', field: '#a49e67', water: '#396f76' },
    upland: { ground: '#626849', light: '#818265', dark: '#434c38', field: '#a29360', water: '#476e72' },
    wet: { ground: '#47664f', light: '#698469', dark: '#304c3d', field: '#9a9e66', water: '#356d77' },
    gorge: { ground: '#4c6250', light: '#71816a', dark: '#344a3d', field: '#969263', water: '#366c75' }
  };
  // 같은 기후권도 지표·식생·건축 재료를 따로 지정한다. 이름별 seed는 세부 배치만 바꾼다.
  const scenery = {
    '무위':['dunes','poplar','earth','#c1a064','#6d563b'], '천수':['terraces','pine','earth','#bca276','#71513d'],
    '장안':['wheat','poplar','earth','#b3a16f','#79674e'], '낙양':['ruins','poplar','stone','#b6a17d','#786454'],
    '한중':['terraces','pine','stone','#83a176','#576b63'], '상당':['heath','pine','stone','#a29b7e','#78796b'],
    '진양':['wheat','poplar','earth','#b1a276','#776b53'], '업':['wheat','grove','stone','#b9ad73','#747d62'],
    '남피':['reeds','poplar','earth','#9ba879','#667c71'], '북평':['heath','pine','stone','#a3aa8b','#6c7979'],
    '평원':['reeds','grove','earth','#b6aa74','#7c8063'], '진류':['wheat','grove','earth','#c1b273','#8b7c59'],
    '복양':['sandbars','poplar','earth','#b4ad7c','#817c5f'], '허창':['orchard','grove','stone','#a9ad72','#6f7e5a'],
    '완':['orchard','grove','earth','#a0a574','#727962'], '소패':['wheat','poplar','earth','#b5ad80','#84816b'],
    '하비':['reeds','willow','stone','#8fac8b','#607d77'], '수춘':['paddy','willow','earth','#9eae7d','#74836a'],
    '합비':['reeds','grove','stone','#8ba891','#5c7b79'], '여남':['wheat','grove','earth','#b5ae74','#7a7958'],
    '양양':['orchard','grove','stone','#98a587','#677b73'], '강하':['sandbars','willow','stone','#92b09b','#597d79'],
    '강릉':['paddy','willow','earth','#96b08a','#657f69'], '장사':['terraces','bamboo','stone','#87a777','#587963'],
    '건업':['orchard','grove','stone','#92a98b','#687c76'], '오':['paddy','willow','stone','#8eb79e','#537f79'],
    '회계':['paddy','bamboo','stone','#84aa8a','#567b68'], '성도':['paddy','bamboo','stone','#9bb381','#6e8768'],
    '강주':['cliffs','bamboo','stone','#8f9e8b','#5c6e70'], '영안':['cliffs','pine','stone','#a5aaa0','#627881']
  };
  function noise(x, y, seed) { const n = Math.sin(x * 127.1 + y * 311.7 + seed * 43.3) * 43758.5453; return n - Math.floor(n); }
  function distance(x, y, pts) {
    let best = Infinity;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i-1], b = pts[i], dx = b[0]-a[0], dy = b[1]-a[1];
      const t = Math.max(0, Math.min(1, ((x-a[0])*dx+(y-a[1])*dy)/(dx*dx+dy*dy || 1)));
      best = Math.min(best, Math.hypot(x-a[0]-t*dx, y-a[1]-t*dy));
    }
    return best;
  }
  function inside(x, y, pts) {
    let yes = false;
    for (let i = 0, j = pts.length-1; i < pts.length; j = i++) {
      const a=pts[i], b=pts[j];
      if ((a[1]>y)!==(b[1]>y) && x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0]) yes=!yes;
    }
    return yes;
  }
  // Test the whole segment between tile centers, including water narrower than a tile.
  // Split at polygon edges so even a very thin channel cannot fall between samples.
  function waterBetween(g, a, b) {
    const ax=a.x+.5, ay=a.y+.5, dx=b.x-a.x, dy=b.y-a.y;
    return g.rivers.concat(g.lakes).some(r=>{
      const cuts=[0,1], pts=r.polygon;
      for(let i=0,j=pts.length-1;i<pts.length;j=i++) {
        const p=pts[j], q=pts[i], ex=q[0]-p[0], ey=q[1]-p[1];
        const det=dx*ey-dy*ex;
        if(Math.abs(det)<1e-10) continue;
        const px=p[0]-ax, py=p[1]-ay;
        const t=(px*ey-py*ex)/det, u=(px*dy-py*dx)/det;
        if(t>0&&t<1&&u>=0&&u<=1) cuts.push(t);
      }
      cuts.sort((x,y)=>x-y);
      return cuts.some((t,i)=>i>0&&t-cuts[i-1]>1e-10&&
        inside(ax+dx*(t+cuts[i-1])*.5,ay+dy*(t+cuts[i-1])*.5,pts));
    });
  }
  // Existing dry-to-dry passages across sub-tile streams also need a visible ford.
  function edgeCrossings(t, g) {
    const out=[];
    for(let y=0;y<ROWS;y++) for(let x=0;x<COLS;x++) {
      if(t[y][x]>=WATER) continue;
      for(const [dx,dy] of [[1,0],[0,1]]) {
        const from={x,y}, to={x:x+dx,y:y+dy};
        if(to.x>=COLS||to.y>=ROWS||t[to.y][to.x]>=WATER||!waterBetween(g,from,to)) continue;
        out.push({from,to,axis:dx?'x':'y'});
      }
    }
    return out;
  }
  // Subdivide the centerline before offsetting its banks: no per-tile disks or scalloped edges.
  function smooth(pts) {
    const out=[];
    for (let i=0;i<pts.length-1;i++) {
      const a=pts[Math.max(0,i-1)], b=pts[i], c=pts[i+1], d=pts[Math.min(pts.length-1,i+2)];
      for (let k=0;k<12;k++) {
        const t=k/12, t2=t*t, t3=t2*t;
        out.push([0,1].map(v=>.5*((2*b[v])+(-a[v]+c[v])*t+(2*a[v]-5*b[v]+4*c[v]-d[v])*t2+(-a[v]+3*b[v]-3*c[v]+d[v])*t3)));
      }
    }
    out.push(pts[pts.length-1]); return out;
  }
  function banks(r, seed) {
    const pts=smooth(r.pts), left=[], right=[];
    pts.forEach((p,i)=>{
      const a=pts[Math.max(0,i-1)], b=pts[Math.min(pts.length-1,i+1)];
      const dx=b[0]-a[0], dy=b[1]-a[1], len=Math.hypot(dx,dy)||1;
      const w=r.w*.5*(1+.09*Math.sin(i*.22+seed));
      left.push([p[0]-dy/len*w,p[1]+dx/len*w]);
      right.push([p[0]+dy/len*w,p[1]-dx/len*w]);
    });
    return { name:r.name, pts, left, right, polygon:left.concat(right.slice().reverse()), w:r.w };
  }
  function neighbors(n) {
    const x=n%COLS, y=Math.floor(n/COLS);
    return [[x-1,y],[x+1,y],[x,y-1],[x,y+1]].filter(p=>p[0]>=0&&p[0]<COLS&&p[1]>=0&&p[1]<ROWS).map(p=>p[1]*COLS+p[0]);
  }
  // Connect every land component, using the least water cells. Broad rivers may need several ford cells.
  function connect(t) {
    const N=COLS*ROWS, at=n=>t[Math.floor(n/COLS)][n%COLS];
    for (let guard=0;guard<N;guard++) {
      const root=Array.from({length:N},(_,i)=>i).find(n=>at(n)!==WATER);
      if (root==null) return;
      const seen=new Set([root]), q=[root];
      for(let i=0;i<q.length;i++) neighbors(q[i]).forEach(n=>{if(at(n)!==WATER&&!seen.has(n)){seen.add(n);q.push(n);}});
      if(!Array.from({length:N},(_,i)=>i).some(n=>at(n)!==WATER&&!seen.has(n))) return;
      const cost=Array(N).fill(Infinity), prev=Array(N).fill(-1), done=new Set();
      seen.forEach(n=>cost[n]=0);
      let end=-1;
      for(let i=0;i<N;i++) {
        let u=-1;
        for(let n=0;n<N;n++) if(!done.has(n)&&(u<0||cost[n]<cost[u])) u=n;
        if(u<0||!Number.isFinite(cost[u])) break;
        if(at(u)!==WATER&&!seen.has(u)){end=u;break;}
        done.add(u);
        neighbors(u).forEach(n=>{
          const x=n%COLS, y=Math.floor(n/COLS), edge=x===0||x===COLS-1||y===0||y===ROWS-1;
          const c=cost[u]+(at(n)===WATER?100+(edge?120:0)+Math.abs(x-6)+Math.abs(y-4):1);
          if(c<cost[n]){cost[n]=c;prev[n]=u;}
        });
      }
      if(end<0) return;
      for(let n=end;prev[n]>=0;n=prev[n]) if(at(n)===WATER) t[Math.floor(n/COLS)][n%COLS]=FORD;
    }
  }
  // A diagonal/narrow stream may leave the land graph connected without any ford.
  // Reserve a complete bank-to-bank crossing for each river, even in that case.
  function riverCrossings(t, rivers) {
    const wet = (x,y) => t[y][x] === WATER || t[y][x] === FORD;
    return rivers.map(r => {
      const candidates = [];
      for (const axis of ['x','y']) {
        const along = axis === 'x' ? COLS : ROWS, across = axis === 'x' ? ROWS : COLS;
        const cell = (a,b) => axis === 'x' ? {x:a,y:b} : {x:b,y:a};
        for (let b=1;b<across-1;b++) {
          for (let a=1;a<along-1;a++) {
            const first = cell(a,b), before = cell(a-1,b);
            if (!wet(first.x,first.y) || wet(before.x,before.y)) continue;
            const cells = [];
            let end = a;
            while (end<along) {
              const c = cell(end,b);
              if (!wet(c.x,c.y)) break;
              cells.push(c);end++;
            }
            if (end>=along || !cells.some(c=>inside(c.x+.5,c.y+.5,r.polygon))) continue;
            const after = cell(end,b), mid = cells[Math.floor(cells.length/2)];
            let nearest = 1, dist = Infinity;
            r.pts.forEach((p,i)=>{
              const d=Math.hypot(p[0]-mid.x-.5,p[1]-mid.y-.5);
              if(d<dist){nearest=i;dist=d;}
            });
            const p=r.pts[Math.max(0,nearest-1)], q=r.pts[Math.min(r.pts.length-1,nearest+1)];
            const dx=q[0]-p[0], dy=q[1]-p[1], length=Math.hypot(dx,dy)||1;
            const normal = (axis==='x'?Math.abs(dy):Math.abs(dx))/length;
            const side = c => dx*(c.y+.5-r.pts[nearest][1])-dy*(c.x+.5-r.pts[nearest][0]);
            if (normal<.6 || side(before)*side(after)>=0) continue;
            const score=cells.filter(c=>t[c.y][c.x]===WATER).length*6+cells.length+
              Math.hypot(mid.x-6,mid.y-4)*.3+(1-normal)*3;
            candidates.push({river:r.name,axis,cells,from:before,to:after,score});
          }
        }
      }
      candidates.sort((a,b)=>a.score-b.score);
      const crossing=candidates[0];
      if (!crossing) throw new Error(r.name + ': 양안 도하점을 만들 수 없습니다.');
      crossing.cells.forEach(c=>{t[c.y][c.x]=FORD;});
      return {river:crossing.river,axis:crossing.axis,cells:crossing.cells,from:crossing.from,to:crossing.to};
    });
  }
  function build(city, siege) {
    const name=city&&city.name||'중원', p=profiles[name]||{region:'중원 평야',detail:'완만한 평지와 수림',theme:'plain',woods:.18};
    const seed=Array.from(name).reduce((s,c)=>s+c.charCodeAt(0),0);
    const rivers=(p.rivers||[]).map((r,i)=>banks(r,seed+i));
    const lakes=(p.lakes||[]).map(l=>({name:l.name,polygon:smooth([l.pts[l.pts.length-1],...l.pts,l.pts[0],l.pts[1]]).slice(12,(l.pts.length+1)*12)}));
    const ridges=(p.ridges||[]).map(r=>({...r,pts:smooth(r.pts)}));
    const water=rivers.concat(lakes), terrain=[], elevation=[];
    for(let y=0;y<ROWS;y++) {
      const row=[], heights=[];
      for(let x=0;x<COLS;x++) {
        const h=ridges.reduce((m,r)=>Math.max(m,1-distance(x+.5,y+.5,r.pts)/(r.w*.5)),0);
        heights.push(h);
        const wet=water.some(r=>inside(x+.5,y+.5,r.polygon));
        const shore=rivers.reduce((m,r)=>Math.min(m,distance(x+.5,y+.5,r.pts)),Infinity);
        const cluster=noise(Math.floor((x+seed%3)/2),Math.floor(y/2),seed);
        const wood=noise(x,y,seed)*.42+cluster*.58;
        row.push(wet?WATER:h>.12?2:wood>1-p.woods-(shore<1.5?.12:0)-(h>0?.1:0)?1:0);
      }
      terrain.push(row); elevation.push(heights);
    }
    connect(terrain);
    const crossings=riverCrossings(terrain,rivers);
    const edgeFords=edgeCrossings(terrain,{rivers,lakes});
    // Three separate strongpoints, in different sectors. Keep one whole tile between castles,
    // preserve water/ford cells, and vary positions with each city's topography.
    if(siege) {
      const anchors=[[6+(seed%2),2],[9,4],[7+(seed%2),7]], forts=[];
      anchors.forEach(a=>{
        let best=null, score=Infinity;
        for(let y=1;y<ROWS-1;y++) for(let x=6;x<COLS-2;x++) {
          if(terrain[y][x]>=WATER||forts.some(f=>Math.max(Math.abs(f[0]-x),Math.abs(f[1]-y))<3)) continue;
          const s=Math.hypot(x-a[0],y-a[1])+(terrain[y][x]===2?1.5:0);
          if(s<score){score=s;best=[x,y];}
        }
        if(best){terrain[best[1]][best[0]]=3;forts.push(best);}
      });
    }
    const look=scenery[name] || ['wheat','grove','stone','#9ba77b','#65745c'];
    const style={surface:look[0],tree:look[1],wall:look[2],rockLight:look[3],rockDark:look[4],angle:(seed%7-3)*.09};
    const scale=typeof citySize==='function'?citySize(city):{rank:2,label:'중도시'};
    const fields=[];
    if(['wheat','paddy','terraces','orchard'].includes(style.surface)) {
      // 경작지는 타일별 장식이 아니라 하천·능선 사이의 연속된 땅에서 잡는다.
      const usable=(x,y)=>x>.15&&x<COLS-.15&&y>.15&&y<ROWS-.15 &&
        !water.some(r=>inside(x,y,r.polygon)) && ridges.every(r=>distance(x,y,r.pts)>r.w*.55);
      for(let i=0;i<55 && fields.length<12;i++) {
        const cx=.7+noise(i,11,seed)*(COLS-1.4),cy=.6+noise(i,23,seed)*(ROWS-1.2);
        if(!usable(cx,cy) || terrain[Math.floor(cy)][Math.floor(cx)]!==0 || fields.some(f=>Math.hypot(f.x-cx,f.y-cy)<1.65)) continue;
        const angle=style.angle+(noise(i,37,seed)-.5)*.8, radius=.8+noise(i,43,seed)*.9, pts=[];
        for(let j=0;j<12;j++) {
          const a=j/12*Math.PI*2, extent=radius*(.75+noise(i,j,seed)*.4);
          let r=.08;
          for(let d=.12;d<=extent;d+=.08) {
            const lx=Math.cos(a)*d,ly=Math.sin(a)*d*.68;
            const x=cx+lx*Math.cos(angle)-ly*Math.sin(angle),y=cy+lx*Math.sin(angle)+ly*Math.cos(angle);
            if(!usable(x,y)) break;r=d;
          }
          const lx=Math.cos(a)*r,ly=Math.sin(a)*r*.68;
          pts.push([cx+lx*Math.cos(angle)-ly*Math.sin(angle),cy+lx*Math.sin(angle)+ly*Math.cos(angle)]);
        }
        if(pts.filter(p=>Math.hypot(p[0]-cx,p[1]-cy)>.4).length<8) continue;
        fields.push({x:cx,y:cy,angle,pts,seed:i});
      }
    }
    return {name,region:p.region,detail:p.detail,theme:p.theme,palette:palettes[p.theme],style,scale,fields,seed,terrain,elevation,rivers,lakes,ridges,crossings,edgeFords,
      labels:[p.region,...rivers.map(r=>r.name),...lakes.map(l=>l.name),...ridges.map(r=>r.name)]};
  }
  return { build, profiles, inside, waterBetween };
})();
if(typeof window!=='undefined') window.BattleTerrain=BattleTerrain;
