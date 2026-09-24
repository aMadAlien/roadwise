import fs from 'fs';

const jsonPath = 'questions.by-topic/37-osnovy-bezpechnoho-vodinnya.json';
const imgDir = 'images/35';

const files = fs.readdirSync(imgDir);
const map = {};
for (const f of files) {
  const m = f.match(/^(\d+)\.(\w+)$/);
  if (m) {
    const n = parseInt(m[1], 10);
    map[n] = map[n] || [];
    map[n].push(f);
  }
}

const dupNumbers = Object.entries(map).filter(([, v]) => v.length > 1);
if (dupNumbers.length) {
  console.log('Duplicate numbers found:', dupNumbers);
}

const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));

let filled = 0;
let missing = [];
for (const item of data) {
  if (item.image === null) {
    const num = item.source && item.source.number;
    const files = map[num];
    if (files && files.length > 0) {
      item.image = `/${imgDir}/${files[0]}`;
      filled++;
    } else {
      missing.push(num);
    }
  }
}

fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2) + '\n', 'utf8');

console.log('Filled:', filled);
console.log('Missing image for numbers:', missing);
