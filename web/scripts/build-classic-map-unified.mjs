/**
 * standard.map から STP/SPA/BUL を単一プロヴィンスに統合した隣接・州メタを生成する。
 */
import fs from 'fs';

const root = '/Users/kohei_takada/Documents/Projects/ディプロマシー/web/src';
const mapPath = '/tmp/standard.map';
if (!fs.existsSync(mapPath)) {
  console.error('Missing', mapPath, '- curl diplomacy standard.map first');
  process.exit(1);
}

const prevJa = {};
const prevPath = `${root}/classicProvinces.json`;
if (fs.existsSync(prevPath)) {
  for (const p of JSON.parse(fs.readFileSync(prevPath, 'utf8'))) {
    if (p.ja && !/_NC$|_SC$|_EC$/.test(p.id)) {
      prevJa[p.id] = p.ja;
    }
  }
}

const raw = fs.readFileSync(mapPath, 'utf8');
const lines = raw.split('\n');

function canon(tok) {
  const t = tok.trim().toUpperCase();
  if (t.startsWith('STP')) {
    return 'STP';
  }
  if (t.startsWith('SPA')) {
    return 'SPA';
  }
  if (t.startsWith('BUL')) {
    return 'BUL';
  }
  return t;
}

const pairs = new Set();
const typeById = new Map();

for (const line of lines) {
  if (line.startsWith('WATER ') || line.startsWith('LAND ') || line.startsWith('COAST ')) {
    const parts = line.split(/\s+/);
    const kind = parts[0];
    const pid = canon(parts[1]);
    if (pid === 'SWI') {
      continue;
    }
    typeById.set(pid, kind);
  }
  if (!line.includes('ABUTS')) {
    continue;
  }
  const parts = line.split(/\s+/);
  const abutsIdx = parts.indexOf('ABUTS');
  if (abutsIdx < 2) {
    continue;
  }
  const self = canon(parts[1]);
  if (self === 'SWI') {
    continue;
  }
  for (let i = abutsIdx + 1; i < parts.length; i++) {
    const other = canon(parts[i]);
    if (other === 'SWI' || !other) {
      continue;
    }
    if (self === other) {
      continue;
    }
    const a = self < other ? self : other;
    const b = self < other ? other : self;
    pairs.add(`${a}|${b}`);
  }
}

const list = [...pairs].map((s) => s.split('|')).sort((x, y) => `${x[0]},${x[1]}`.localeCompare(`${y[0]},${y[1]}`));

const allIds = new Set();
for (const [a, b] of list) {
  allIds.add(a);
  allIds.add(b);
}

const jaOverride = {
  APU: 'アビュリア',
  BOT: 'ボトニア湾',
  GAL: 'ガリシア',
  PRU: 'プロシア',
  VEN: 'ヴェニス',
};

const homeSc = {
  ENG: ['EDI', 'LON', 'LVP'],
  FRA: ['BRE', 'MAR', 'PAR'],
  GER: ['BER', 'KIE', 'MUN'],
  ITA: ['NAP', 'ROM', 'VEN'],
  AUS: ['BUD', 'TRI', 'VIE'],
  RUS: ['MOS', 'SEV', 'STP', 'WAR'],
  TUR: ['ANK', 'CON', 'SMY'],
};

const neutralSc = new Set(['BEL', 'BUL', 'DEN', 'GRE', 'HOL', 'NWY', 'POR', 'RUM', 'SER', 'SPA', 'SWE', 'TUN']);

const provinces = [...allIds].sort().map((id) => {
  const kind = typeById.get(id) || 'COAST';
  const areaType = kind === 'WATER' ? 'Sea' : kind === 'LAND' ? 'Land' : 'Coastal';
  let isSupplyCenter = false;
  let homePowerId;
  for (const [p, scs] of Object.entries(homeSc)) {
    if (scs.includes(id)) {
      isSupplyCenter = true;
      homePowerId = p;
      break;
    }
  }
  if (!isSupplyCenter && neutralSc.has(id)) {
    isSupplyCenter = true;
  }
  return {
    id,
    ja: jaOverride[id] ?? prevJa[id] ?? id,
    areaType,
    isSupplyCenter,
    ...(homePowerId ? { homePowerId } : {}),
  };
});

fs.writeFileSync(`${root}/classicAdjacencies.json`, JSON.stringify(list));
fs.writeFileSync(`${root}/classicProvinces.json`, JSON.stringify(provinces, null, 2));
console.log('unified pairs', list.length, 'provinces', provinces.length);
