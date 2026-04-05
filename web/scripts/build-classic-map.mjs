/**
 * standard.map から classicAdjacencies.json と province メタの骨子を出力する。
 */
import fs from 'fs';

const raw = fs.readFileSync('/tmp/standard.map', 'utf8');
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
const typeByCanon = new Map();

for (const line of lines) {
  if (line.startsWith('WATER ') || line.startsWith('LAND ') || line.startsWith('COAST ')) {
    const parts = line.split(/\s+/);
    const kind = parts[0];
    const pid = canon(parts[1]);
    if (pid === 'SWI') {
      continue;
    }
    if (!typeByCanon.has(pid) || kind === 'LAND') {
      typeByCanon.set(pid, kind);
    }
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

const jaNames = {
  ADR: 'アドリア海',
  AEG: 'エーゲ海',
  ALB: 'アルバニア',
  ANK: 'アンカラ',
  APU: 'アプリア',
  ARM: 'アルメニア',
  BAL: 'バルト海',
  BAR: 'バレンツ海',
  BEL: 'ベルギー',
  BER: 'ベルリン',
  BLA: '黒海',
  BOH: 'ボヘミア',
  BOT: 'ボトニア湾',
  BRE: 'ブレスト',
  BUD: 'ブダペスト',
  BUL: 'ブルガリア',
  BUR: 'ブルゴーニュ',
  CLY: 'クライド',
  CON: 'コンスタンティノープル',
  DEN: 'デンマーク',
  EAS: '東地中海',
  EDI: 'エディンバラ',
  ENG: 'イギリス海峡',
  FIN: 'フィンランド',
  GAL: 'ガリツィア',
  GAS: 'ガスコーニュ',
  GRE: 'ギリシャ',
  HEL: 'ヘルゴラント湾',
  HOL: 'オランダ',
  ION: 'イオニア海',
  IRI: 'アイリッシュ海',
  KIE: 'キール',
  LON: 'ロンドン',
  LVN: 'リヴォニア',
  LVP: 'リヴァプール',
  LYO: 'リヨン湾',
  MAO: '中大西洋',
  MAR: 'マルセイユ',
  MOS: 'モスクワ',
  MUN: 'ミュンヘン',
  NAF: '北アフリカ',
  NAO: '北大西洋',
  NAP: 'ナポリ',
  NTH: '北海',
  NWG: 'ノルウェー海',
  NWY: 'ノルウェー',
  PAR: 'パリ',
  PIC: 'ピカルディ',
  PIE: 'ピエモンテ',
  POR: 'ポルトガル',
  PRU: 'プロイセン',
  ROM: 'ローマ',
  RUH: 'ルール',
  RUM: 'ルーマニア',
  SER: 'セルビア',
  SEV: 'セヴァストポリ',
  SIL: 'シレジア',
  SKA: 'スカゲラク',
  SMY: 'スミルナ',
  SPA: 'スペイン',
  STP: 'サンクトペテルブルク',
  SWE: 'スウェーデン',
  SYR: 'シリア',
  TRI: 'トリエステ',
  TUN: 'チュニジア',
  TUS: 'トスカーナ',
  TYR: 'チロル',
  TYS: 'ティレニア海',
  UKR: 'ウクライナ',
  VEN: 'ヴェネツィア',
  VIE: 'ウィーン',
  WAL: 'ウェールズ',
  WAR: 'ワルシャワ',
  WES: '西地中海',
  YOR: 'ヨークシャー',
};

const list = [...pairs].map((s) => s.split('|')).sort((x, y) => `${x[0]},${x[1]}`.localeCompare(`${y[0]},${y[1]}`));

const allIds = new Set();
for (const [a, b] of list) {
  allIds.add(a);
  allIds.add(b);
}

const provinces = [...allIds].sort().map((id) => {
  const kind = typeByCanon.get(id) || 'COAST';
  const areaType = kind === 'WATER' ? 'Sea' : kind === 'LAND' ? 'Land' : 'Coastal';
  let homePowerId = undefined;
  for (const [p, scs] of Object.entries(homeSc)) {
    if (scs.includes(id)) {
      homePowerId = p;
      break;
    }
  }
  const isSupplyCenter =
    homePowerId !== undefined || neutralSc.has(id);
  return { id, ja: jaNames[id] || id, areaType, isSupplyCenter, homePowerId };
});

fs.writeFileSync(
  '/Users/kohei_takada/Documents/Projects/ディプロマシー/web/src/classicAdjacencies.json',
  JSON.stringify(list),
);

fs.writeFileSync(
  '/Users/kohei_takada/Documents/Projects/ディプロマシー/web/src/classicProvinces.json',
  JSON.stringify(provinces, null, 2),
);

console.log('wrote classicAdjacencies.json pairs=', list.length);
console.log('wrote classicProvinces.json count=', provinces.length);
