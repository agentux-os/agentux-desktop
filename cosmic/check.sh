#!/usr/bin/env bash
# Validate the COSMIC-specific bundle independently of Plasma tooling.
set -euo pipefail
cd "$(dirname "$0")"
palette=usr/share/cosmic/com.system76.CosmicSettings/v1/accent_palette_dark.ron
[[ -f "$palette" ]] || { echo "error: missing $palette" >&2; exit 1; }
node - "$palette" <<'NODE'
const fs = require('node:fs');
const source = fs.readFileSync(process.argv[2], 'utf8');
const tuples = [...source.matchAll(/\(red:\s*([\d.]+),\s*green:\s*([\d.]+),\s*blue:\s*([\d.]+),\s*alpha:\s*([\d.]+)\)/g)];
if (tuples.length !== 9) throw new Error(`expected 9 COSMIC palette colors, found ${tuples.length}`);
for (const tuple of tuples) for (const value of tuple.slice(1).map(Number)) {
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error(`invalid RON color component: ${value}`);
}
NODE
echo 'COSMIC bundle: OK'
