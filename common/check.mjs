import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const common = path.join(path.dirname(fileURLToPath(import.meta.url)), 'usr');
const required = [
  'libexec/agentux-setup',
  'share/agentux/setup/catalog.json',
  'share/agentux/setup/flathub.flatpakrepo',
  'share/applications/agentux-welcome.desktop',
  'libexec/agentux-cockpit-autostart',
];

for (const relative of required) {
  assert.ok(existsSync(path.join(common, relative)), `shared overlay missing ${relative}`);
}

const setup = readFileSync(path.join(common, 'libexec/agentux-setup'), 'utf8');
assert.match(setup, /^#!/m, 'shared setup backend must remain an executable script');
const welcome = readFileSync(path.join(common, 'share/applications/agentux-welcome.desktop'), 'utf8');
assert.match(welcome, /^Exec=agentux-cockpit --welcome$/m);
for (const launcher of ['etc/xdg/autostart/agentux-welcome.desktop', 'etc/xdg/autostart/agentux-cockpit.desktop']) {
  const entry = readFileSync(path.join(path.dirname(common), launcher), 'utf8');
  assert.doesNotMatch(entry, /^OnlyShowIn=KDE;$/m, `${launcher} must be desktop-neutral`);
}

const forbidden = [
  'share/plasma',
  'share/wayland-sessions/agentux-plasma.desktop',
  'lib/plasmalogin',
];
for (const relative of forbidden) {
  assert.ok(!existsSync(path.join(common, relative)), `shared overlay must not contain Plasma-specific ${relative}`);
}

console.log('shared desktop overlay: OK');
