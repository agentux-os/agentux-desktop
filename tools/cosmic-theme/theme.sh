#!/usr/bin/env bash
# Check (or with --write, update) the computed COSMIC theme keys this overlay
# ships against what libcosmic builds from the theme builders.
#
# COSMIC's desktop reads com.system76.CosmicTheme.Dark/.Light, the theme
# COSMIC Settings builds from com.system76.CosmicTheme.*.Builder, so a builder
# default alone (the AgentUX accent) does not show until a user changes the
# appearance. This builds the themes with libcosmic's own code (this
# directory, at the revision Fedora's cosmic-settings uses) twice: from Fedora
# 44's cosmic-settings defaults, and from them with this overlay on top, as in
# the image. The overlay ships the keys whose values differ between the two
# builds, and no other theme key: each as Fedora ships it, with the values
# that differ taken from the AgentUX build (merge.mjs; Fedora's shipped theme
# is older than its builder in places, which this leaves as Fedora's).
# --write updates usr/ to that.
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
cp -a "$work/fedora" "$work/agentux"
cp -a usr "$work/agentux/"
# The theme keys the overlay ships are what this decides, not an input.
rm -rf "$work/agentux/usr/share/cosmic/com.system76.CosmicTheme.Dark" \
    "$work/agentux/usr/share/cosmic/com.system76.CosmicTheme.Light"

cargo build --quiet --release --manifest-path "$here/Cargo.toml"
gen=$here/target/release/agentux-cosmic-theme-gen
same() { node "$here/same.mjs" "$1" "$2"; }
for tree in fedora agentux; do
    XDG_DATA_DIRS="$work/$tree/usr/share" XDG_CONFIG_HOME="$work/$tree-out" "$gen"
done

ok=1
for theme in com.system76.CosmicTheme.Dark com.system76.CosmicTheme.Light; do
    for built in "$work/agentux-out/cosmic/$theme/v1"/*; do
        key=$(basename "$built")
        base="$work/fedora-out/cosmic/$theme/v1/$key"
        fedora="$work/fedora/usr/share/cosmic/$theme/v1/$key"
        shipped="usr/share/cosmic/$theme/v1/$key"
        if same "$built" "$base"; then
            # Not changed by the overlay: Fedora's own stays.
            if [[ -f "$shipped" ]]; then
                if [[ "$write" == 1 ]]; then
                    rm "$shipped"; echo "removed $shipped"
                else
                    echo "::error::$shipped is not changed by the AgentUX builders; drop it"; ok=0
                fi
            fi
            continue
        fi
        expected="$work/expected-$theme-$key"
        node "$here/merge.mjs" "$fedora" "$base" "$built" >"$expected" || { ok=0; continue; }
        [[ -f "$shipped" ]] && same "$expected" "$shipped" && { echo "ok: $shipped"; continue; }
        if [[ "$write" == 1 ]]; then
            install -D -m 0644 "$expected" "$shipped"; echo "wrote $shipped"
        else
            echo "::error::$shipped is not what the AgentUX builders give (run tools/cosmic-theme/theme.sh --write)"
            [[ -f "$shipped" ]] && { diff "$shipped" "$expected" || true; }
            ok=0
        fi
    done
done
[[ "$ok" == 1 ]]
echo 'COSMIC themes: OK'
