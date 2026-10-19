import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const darkPath = path.join(root, 'usr/share/cosmic/com.system76.CosmicSettings/v1/accent_palette_dark.ron');
const lightPath = path.join(root, 'usr/share/cosmic/com.system76.CosmicSettings/v1/accent_palette_light.ron');
for (const file of [darkPath, lightPath]) {
  assert.ok(existsSync(file), `COSMIC accent palette missing: ${path.relative(root, file)}`);
  const source = readFileSync(file, 'utf8');
  const colors = [...source.matchAll(/red:\s*([\d.]+),\s*green:\s*([\d.]+),\s*blue:\s*([\d.]+),\s*alpha:\s*([\d.]+)/g)];
  assert.equal(colors.length, 9, `${path.basename(file)} must define exactly nine accent colors`);
  for (const color of colors) {
    for (const channel of color.slice(1)) assert.ok(Number(channel) >= 0 && Number(channel) <= 1, 'palette channels must be normalized');
  }
}

// The AgentUX wallpaper is cosmic-bg's system default (desktop and lock
// screen), and it points at a file this overlay ships.
const backgroundPath = path.join(root, 'usr/share/cosmic/com.system76.CosmicBackground/v1/all');
assert.ok(existsSync(backgroundPath), 'COSMIC background default missing');
const background = readFileSync(backgroundPath, 'utf8');
assert.match(background, /output:\s*"all"/, 'the COSMIC background default must apply to all outputs');
const source = background.match(/source:\s*Path\("([^"]+)"\)/);
assert.ok(source, 'the COSMIC background default must name an image path');
assert.match(source[1], /^\/usr\/share\/backgrounds\/agentux\//, 'the COSMIC wallpaper must be an AgentUX one');
const image = path.join(root, source[1]);
assert.ok(existsSync(image), `COSMIC wallpaper missing: ${source[1]}`);
assert.deepEqual([...readFileSync(image).subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 'the COSMIC wallpaper must be a PNG');

// The dock pins the cockpit first, then the terminal and the browser,
// like Plasma's panel.
const favorites = readFileSync(path.join(root, 'usr/share/cosmic/com.system76.CosmicAppList/v1/favorites'), 'utf8');
const pinned = [...favorites.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
assert.deepEqual(pinned.slice(0, 3), ['agentux-cockpit', 'com.system76.CosmicTerm', 'firefox'], 'the COSMIC dock must pin the cockpit, the terminal and the browser first');
assert.equal(new Set(pinned).size, pinned.length, 'the COSMIC dock pins an app twice');

// Super+C opens the cockpit (Meta+C on Plasma) and Super+Return a terminal.
// Super+A stays COSMIC's App Library.
const shortcuts = readFileSync(path.join(root, 'usr/share/cosmic/com.system76.CosmicSettings.Shortcuts/v1/custom'), 'utf8');
assert.match(shortcuts, /\(modifiers: \[Super\], key: "c"\): Spawn\("agentux-cockpit"\)/, 'Super+C must open the cockpit');
assert.match(shortcuts, /\(modifiers: \[Super\], key: "Return"\): System\(Terminal\)/, 'Super+Return must open the terminal');
assert.doesNotMatch(shortcuts, /key: "a"\)/, 'Super+A belongs to COSMIC (App Library)');

// The active accent is the first colour of each AgentUX palette.
for (const [theme, palette] of [['Dark', darkPath], ['Light', lightPath]]) {
  const accent = readFileSync(path.join(root, `usr/share/cosmic/com.system76.CosmicTheme.${theme}.Builder/v1/accent`), 'utf8');
  const [, red, green, blue] = accent.match(/Some\(\(\s*red:\s*([\d.]+),\s*green:\s*([\d.]+),\s*blue:\s*([\d.]+),?\s*\)\)/) ?? [];
  assert.ok(red, `the ${theme} accent must be Some((red, green, blue))`);
  const first = readFileSync(palette, 'utf8').match(/red:\s*([\d.]+),\s*green:\s*([\d.]+),\s*blue:\s*([\d.]+)/);
  assert.deepEqual([red, green, blue].map(Number), first.slice(1, 4).map(Number), `the ${theme} accent must be the first colour of its palette`);
}

function checkNoPlasma(directory) {
  if (!existsSync(directory)) return;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const item = path.join(directory, entry.name);
    assert.ok(!/(plasma|plasmalogin|wayland-sessions)/i.test(entry.name), `COSMIC overlay contains a Plasma-specific path: ${path.relative(root, item)}`);
    if (entry.isDirectory()) checkNoPlasma(item);
  }
}

checkNoPlasma(path.join(root, 'usr'));
for (const launcher of [
  '../common/etc/xdg/autostart/agentux-welcome.desktop',
  '../common/etc/xdg/autostart/agentux-cockpit.desktop',
]) {
  const entry = readFileSync(path.resolve(root, launcher), 'utf8');
  assert.doesNotMatch(entry, /^OnlyShowIn=KDE;$/m, 'shared launchers must be available in COSMIC');
}
console.log('COSMIC desktop overlay: OK');
