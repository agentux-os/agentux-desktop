// Whether two RON files hold the same values, up to float rounding: the
// generator's floats differ from Fedora's in the last digits (and in -0.0
// against 0.0), depending on the compiler and target that built each.
// Usage: node same.mjs a b (exit 0 if same, 1 otherwise).
import { readFileSync } from 'node:fs';

const tokens = (file) => readFileSync(file, 'utf8').match(/-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?|[^\s\d-]+|-/g) ?? [];
const [a, b] = process.argv.slice(2).map(tokens);
const number = /^-?\d/;
const same = a.length === b.length && a.every((token, i) =>
  number.test(token) && number.test(b[i]) ? Math.abs(Number(token) - Number(b[i])) <= 1e-5 : token === b[i]);
process.exit(same ? 0 : 1);
