// Prints Fedora's theme key with the values the AgentUX builders change.
// Usage: node merge.mjs fedora base built
//   fedora: the key as Fedora ships it
//   base:   the key built from Fedora's builder
//   built:  the key built from the AgentUX builder
// Fedora's shipped theme is older than its builder in places (its palette
// and status colours), so instead of the whole built key this keeps
// Fedora's text and takes from `built` only the values that differ between
// the two builds (e.g. the accent in a button's focus ring). The three must
// have the same shape; values compare up to float rounding, as in same.mjs.
import { readFileSync } from 'node:fs';

const split = (file) => readFileSync(file, 'utf8').split(/(-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?)/);
const [fedora, base, built] = process.argv.slice(2).map(split);
const isNumber = (_, i) => i % 2 === 1;
if (fedora.length !== base.length || base.length !== built.length
  || fedora.some((part, i) => !isNumber(part, i) && (part.trim() !== base[i].trim() || part.trim() !== built[i].trim()))) {
  console.error(`${process.argv[2]}: Fedora's key and the built ones differ in shape`);
  process.exit(1);
}
const near = (a, b) => Math.abs(Number(a) - Number(b)) <= 1e-5;
process.stdout.write(fedora.map((part, i) => (isNumber(part, i) && !near(base[i], built[i]) ? built[i] : part)).join(''));
