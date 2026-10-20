#!/usr/bin/env bash
# Check (or with --write, update) the computed COSMIC themes this overlay
# ships against what libcosmic builds from the theme builders.
#
# COSMIC's desktop reads com.system76.CosmicTheme.Dark/.Light, the theme
# COSMIC Settings builds from com.system76.CosmicTheme.*.Builder, so a builder
# default alone (the AgentUX accent) does not show until a user changes the
# appearance. This builds the themes with libcosmic's own code
# (this directory, at the revision Fedora's cosmic-settings uses), from Fedora 44's
# cosmic-settings defaults with this overlay on top, as in the image:
#
# 1. from Fedora's defaults alone it must give Fedora's own theme files (the
#    generator builds themes the way Fedora's were made);
# 2. with the overlay, every theme file must match what the overlay ships
#    (--write copies the ones that differ into usr/).
#
# Values are compared up to float rounding (same.mjs).
#
# Needs dnf, rpm2cpio, cpio, cargo and node (Fedora 44).
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
cd "$here/../../cosmic"
write=0
[[ "${1:-}" == --write ]] && write=1

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
dnf -q download --destdir "$work/rpm" cosmic-settings
mkdir "$work/fedora"
(cd "$work/fedora" && rpm2cpio "$work"/rpm/cosmic-settings-*.rpm | cpio -idm --quiet)

cargo build --quiet --release --manifest-path "$here/Cargo.toml"
gen=$here/target/release/agentux-cosmic-theme-gen
same() { node "$here/same.mjs" "$1" "$2"; }
themes=(com.system76.CosmicTheme.Dark com.system76.CosmicTheme.Light)
ok=1

# 1. Fedora's builders give Fedora's themes.
XDG_DATA_DIRS="$work/fedora/usr/share" XDG_CONFIG_HOME="$work/fedora-out" "$gen"
for theme in "${themes[@]}"; do
    for built in "$work/fedora-out/cosmic/$theme/v1"/*; do
        key=$(basename "$built")
        if ! same "$built" "$work/fedora/usr/share/cosmic/$theme/v1/$key"; then
            echo "::error::$theme/$key built from Fedora's builder differs from Fedora's own"
            diff "$work/fedora/usr/share/cosmic/$theme/v1/$key" "$built" || true
            ok=0
        fi
    done
done
[[ "$ok" == 1 ]] || { echo "error: the generator does not reproduce Fedora's themes" >&2; exit 1; }

# 2. With the overlay, the shipped themes are what the builders give.
cp -a "$work/fedora" "$work/agentux"
cp -a usr "$work/agentux/"
XDG_DATA_DIRS="$work/agentux/usr/share" XDG_CONFIG_HOME="$work/agentux-out" "$gen"
for theme in "${themes[@]}"; do
    for built in "$work/agentux-out/cosmic/$theme/v1"/*; do
        key=$(basename "$built")
        shipped="$work/agentux/usr/share/cosmic/$theme/v1/$key"
        [[ -f "$shipped" ]] && same "$built" "$shipped" && continue
        if [[ "$write" == 1 ]]; then
            install -D -m 0644 "$built" "usr/share/cosmic/$theme/v1/$key"
            echo "wrote usr/share/cosmic/$theme/v1/$key"
        else
            echo "::error::$theme/$key is not what the AgentUX builder gives (run tools/cosmic-theme/theme.sh --write)"
            diff "$shipped" "$built" || true
            ok=0
        fi
    done
done
[[ "$ok" == 1 ]]
echo 'COSMIC themes: OK'
