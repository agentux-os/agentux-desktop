import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const workflow = await readFile('.github/workflows/release.yml', 'utf8');
const roots = ['common', 'plasma', 'cosmic'];

assert.match(workflow, /for bundle in common plasma cosmic/, 'release must package all three bundle roots');
assert.match(workflow, /tar -C "\$bundle" --sort=name/, 'release packaging must be deterministic');
assert.match(workflow, /agentux-desktop-\$\{bundle\}-\$\{version\}\.tar\.gz/, 'release must use the named versioned bundle contract');
assert.match(workflow, /sha256sum/, 'release must checksum each archive');

assert.match(workflow, /tar -tzf[\s\S]*?\^\(usr\|etc\)/, 'bundle packaging must restrict paths to install roots');
assert.match(workflow, /comm -12|collision/i, 'release must reject common/overlay file collisions');
assert.match(workflow, /agentux-desktop-\*\.tar\.gz/, 'manual workflow artifacts must include all named bundles');
for (const root of roots) {
  assert.ok(workflow.includes(`agentux-desktop-${root}-*.tar.gz`), `tagged release must attach ${root}`);
  assert.ok(workflow.includes(`agentux-desktop-${root}-*.tar.gz.sha256`), `tagged release must attach ${root} checksum`);
}
assert.match(workflow, /rpm -qip[\s\S]*agentux-cockpit|test "\$\(rpm -q --qf[^\n]*agentux-cockpit/, 'RPM identity must remain agentux-cockpit');
console.log('release artifact contract: OK');
