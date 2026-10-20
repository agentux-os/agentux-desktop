import assert from 'node:assert/strict';
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';

const roots = ['common', 'plasma', 'cosmic'];
const required = [
  'common/usr/libexec/agentux-setup',
  'common/usr/libexec/agentux-cockpit-autostart',
  'common/usr/share/agentux/setup/catalog.json',
  'common/usr/share/agentux/setup/flathub.flatpakrepo',
  'common/usr/share/applications/agentux-welcome.desktop',
  'common/etc/xdg/autostart/agentux-cockpit.desktop',
  'common/etc/xdg/autostart/agentux-welcome.desktop',
  'plasma/check.sh',
  'common/check.sh',
  'common/check.mjs',
  'cosmic/check.sh',
  'cosmic/check.mjs',
  'cosmic/usr/share/cosmic/com.system76.CosmicSettings/v1/accent_palette_dark.ron',
  'cosmic/usr/share/cosmic/com.system76.CosmicBackground/v1/all',
  'cosmic/usr/share/backgrounds/agentux/agentux-dark.png',
  'cosmic/usr/share/cosmic/com.system76.CosmicAppList/v1/favorites',
  'cosmic/usr/share/cosmic/com.system76.CosmicSettings.Shortcuts/v1/custom',
  'cosmic/usr/share/cosmic/com.system76.CosmicTheme.Dark.Builder/v2/accent',
  'cosmic/usr/share/cosmic/com.system76.CosmicTheme.Light.Builder/v2/accent',
  'cosmic/usr/share/cosmic/com.system76.CosmicTheme.Dark/v2/accent',
  'cosmic/usr/share/cosmic/com.system76.CosmicTheme.Light/v2/accent',
  'tools/cosmic-theme/theme.sh',
];

for (const path of required) {
  await stat(path);
}

const commonValidator = await readFile('common/check.sh', 'utf8');
assert.match(commonValidator, /usr\|etc\|check\.sh\|check\.mjs/, 'common validator must allow its source validators');

for (const root of roots) {
  const topLevel = await readdir(root);
  for (const entry of topLevel) {
    assert.ok(['usr', 'etc', 'check.sh', 'check.mjs'].includes(entry), `${root}/${entry} is not an install root or validator`);
  }
  const visit = async (path) => {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const child = join(path, entry.name);
      if (child === join(root, 'check.sh') || child === join(root, 'check.mjs')) continue;
      const relative = child.slice(root.length + 1).replaceAll('\\', '/');
      assert.match(relative, /^(usr|etc)(\/|$)/, `${child} is outside install roots`);
      assert.doesNotMatch(relative, /(^|\/)(build|test|tests)(\/|$)/i, `${child} is a build/test file`);
      if (root === 'common') {
        assert.doesNotMatch(relative, /(^|\/)(kde|plasma|cosmic|hyprland)(\/|$)/i, `${child} is desktop-specific`);
      }
      if (entry.isDirectory()) await visit(child);
    }
  };
  await visit(root);
}

console.log('desktop bundle layout: OK');

// The wizard's sign-in opens the desktop's own terminal: Konsole on Plasma,
// COSMIC Terminal on COSMIC (which has neither Konsole nor, always,
// xdg-terminal-exec).
const setup = await readFile('common/usr/libexec/agentux-setup', 'utf8');
assert.match(setup, /command -v cosmic-term[\s\S]*cosmic-term -e bash -lc/, 'agentux-setup opens COSMIC Terminal on COSMIC');
assert.doesNotMatch(setup, /\bfoot\b/, 'agentux-setup no longer tries foot (Hyprland only)');
