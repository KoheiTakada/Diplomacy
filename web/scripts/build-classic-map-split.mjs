/**
 * standard.map から海岸分割ありの隣接・州メタを生成する。
 * STP/SPA/BUL の統合行（stp, spa, bul）はスキップし、陸軍コア用の辺を手動追加する。
 */
import fs from 'fs';

const root = '/Users/kohei_takada/Documents/Projects/ディプロマシー/web/src';
const prevPath = `${root}/classicProvinces.json`;
const prevJa = {};
if (fs.existsSync(prevPath)) {
  const prev = JSON.parse(fs.readFileSync(prevPath, 'utf8'));
  for (const p of prev) {
    if (p.ja) {
      prevJa[p.id] = p.ja;
    }
  }
}

const raw = fs.readFileSync('/tmp/standard.map', 'utf8');
const lines = raw.split('\n');

/** トークンを正規化（公式略号・海岸） */
function canonToken(tok) {
  const t = tok.trim().toUpperCase();
  const map = {
    'STP/NC': 'STP_NC',
    'STP/SC': 'STP_SC',
    'SPA/NC': 'SPA_NC',
    'SPA/SC': 'SPA_SC',
    'BUL/EC': 'BUL_EC',
    'BUL/SC': 'BUL_SC',
  };
  if (map[t]) {
    return map[t];
  }
  if (t === 'STP' || t === 'SPA' || t === 'BUL') {
    return t;
  }
  return t;
}

const skipProvinceNames = new Set(['STP', 'SPA', 'BUL'].map((x) => x.toLowerCase()));

const pairs = new Set();
const typeById = new Map();

for (const line of lines) {
  if (line.startsWith('WATER ') || line.startsWith('LAND ') || line.startsWith('COAST ')) {
    const parts = line.split(/\s+/);
    const kind = parts[0];
    const rawId = parts[1];
    if (!rawId || rawId === 'SWI') {
      continue;
    }
    const low = rawId.toLowerCase();
    if (skipProvinceNames.has(low)) {
      continue;
    }
    const pid = canonToken(rawId);
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
  const selfRaw = parts[1];
  if (skipProvinceNames.has(selfRaw.toLowerCase())) {
    continue;
  }
  const self = canonToken(selfRaw);
  if (self === 'SWI') {
    continue;
  }
  for (let i = abutsIdx + 1; i < parts.length; i++) {
    const other = canonToken(parts[i]);
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

/** 陸軍コアのみの隣接（統合 stp/spa/bul 行の代替） */
const armyCoreEdges = [
  ['STP', 'FIN'],
  ['STP', 'LVN'],
  ['STP', 'MOS'],
  ['STP', 'NWY'],
  ['SPA', 'GAS'],
  ['SPA', 'LYO'],
  ['SPA', 'MAR'],
  ['SPA', 'POR'],
  ['SPA', 'WES'],
  ['BUL', 'CON'],
  ['BUL', 'GRE'],
  ['BUL', 'RUM'],
  ['BUL', 'SER'],
];
for (const [x, y] of armyCoreEdges) {
  const a = x < y ? x : y;
  const b = x < y ? y : x;
  pairs.add(`${a}|${b}`);
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
  STP: 'サンクトペテルブルク',
  STP_NC: 'サンクトP・北岸',
  STP_SC: 'サンクトP・南岸',
  SPA: 'スペイン',
  SPA_NC: 'スペイン・北岸',
  SPA_SC: 'スペイン・南岸',
  BUL: 'ブルガリア',
  BUL_EC: 'ブルガリア・東岸',
  BUL_SC: 'ブルガリア・南岸',
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

const neutralSc = new Set(['BEL', 'DEN', 'GRE', 'HOL', 'NWY', 'POR', 'RUM', 'SER', 'SPA', 'SWE', 'TUN', 'BUL']);

/** 陸軍のみが占める補給コア（海軍不可） */
const armyOnlyCore = new Set(['STP', 'SPA', 'BUL']);

/** 海軍のみが占める岸（陸軍不可） */
const fleetOnlyCoast = new Set(['STP_NC', 'STP_SC', 'SPA_NC', 'SPA_SC', 'BUL_EC', 'BUL_SC']);

/** ホームの補給コアと同じ勢力の増産で海軍を置ける分割岸（露のサンクトのみ） */
const fleetHomeCoast = {
  STP_NC: 'RUS',
  STP_SC: 'RUS',
};

const provinces = [...allIds].sort().map((id) => {
  const kind = typeById.get(id) || 'COAST';
  let areaType = kind === 'WATER' ? 'Sea' : kind === 'LAND' ? 'Land' : 'Coastal';
  if (armyOnlyCore.has(id)) {
    areaType = 'Land';
  }
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
  if (fleetHomeCoast[id]) {
    homePowerId = fleetHomeCoast[id];
  }

  const row = {
    id,
    ja: jaOverride[id] ?? prevJa[id] ?? id,
    areaType,
    isSupplyCenter,
    fleetOnlyCoast: fleetOnlyCoast.has(id),
    armyOnlyCore: armyOnlyCore.has(id),
  };
  if (homePowerId) {
    row.homePowerId = homePowerId;
  }
  if (fleetOnlyCoast.has(id)) {
    if (id.startsWith('STP_')) {
      row.supplyAnchorId = 'STP';
    } else if (id.startsWith('SPA_')) {
      row.supplyAnchorId = 'SPA';
    } else if (id.startsWith('BUL_')) {
      row.supplyAnchorId = 'BUL';
    }
  }
  return row;
});

fs.writeFileSync(`${root}/classicAdjacencies.json`, JSON.stringify(list));
fs.writeFileSync(`${root}/classicProvinces.json`, JSON.stringify(provinces, null, 2));

console.log('pairs', list.length, 'provinces', provinces.length);
