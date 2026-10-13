// Fails if application source contains deployment-specific host literals (host neutrality, revision 3).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const bad = [];
const walk = (d) =>
  readdirSync(d).forEach((f) => {
    const p = join(d, f);
    statSync(p).isDirectory()
      ? walk(p)
      : /github\.io|pages\.dev/.test(readFileSync(p, 'utf8')) && bad.push(p);
  });
walk('src');
if (bad.length) {
  console.error('Host literals found:', bad);
  process.exit(1);
}
console.log('host-neutral: ok');
