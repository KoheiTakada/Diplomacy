/**
 * diplomacy 公式 standard.map から隣接ペアを抽出し、
 * 単一沿岸（STP/SPA/BUL 統合）・スイス除外のペア一覧を JSON で出力する。
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
for (const line of lines) {
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
    if (other === 'SWI' || !other || other === 'ABUTS') {
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

const list = [...pairs].map((s) => s.split('|')).sort((x, y) => (x[0] + x[1]).localeCompare(y[0] + y[1]));
console.log(JSON.stringify(list, null, 0));
