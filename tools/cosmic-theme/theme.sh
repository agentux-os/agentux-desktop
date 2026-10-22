#!/usr/bin/env bash
# Check (or with --write, update) the computed COSMIC theme keys this overlay
# ships against what libcosmic builds from the theme builders.
#
# COSMIC's desktop reads com.system76.CosmicTheme.Dark/.Light, the theme
# COSMIC Settings builds from com.system76.CosmicTheme.*.Builder, so a builder
# default alone (the AgentUX accent) does not show until a user changes the
# appearance. This builds the themes with libcosmic's own code (this
# directory, at the revision of Fedora's COSMIC release) from Fedora 44's
# cosmic-settings defaults with this overlay on top, as in the image, and the
# overlay ships the whole theme it builds: what COSMIC Settings would write
# for the AgentUX accent. (Fedora's own COSMIC theme defaults, 1.10 and 1.11, do not
# match its code: keys are missing and its builder palette does not parse, so
# COSMIC falls back key by key. A whole built theme loads cleanly.)
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
# The generator is pinned to the libcosmic revision of one COSMIC release
# (Cargo.toml); a newer Fedora COSMIC may change the theme (COSMIC 1.10 moved
# it to a v2 schema), so the two must move together.
epoch=1.11.0
version=$(rpm -qp --qf '%{VERSION}' "$work"/rpm/cosmic-settings-*.rpm)
[[ "$version" == "$epoch" ]] || {
    echo "::error::Fedora's cosmic-settings is $version, the theme generator is pinned to COSMIC $epoch: update its libcosmic revision (Cargo.toml) and epoch here, then run theme.sh --write"
    exit 1
}
mkdir "$work/fedora"
(cd "$work/fedora" && rpm2cpio "$work"/rpm/cosmic-settings-*.rpm | cpio -idm --quiet)
cp -a "$work/fedora" "$work/agentux"
cp -a usr "$work/agentux/"
# The theme the overlay ships is what this decides, not an input.
rm -rf "$work/agentux/usr/share/cosmic/com.system76.CosmicTheme.Dark"     "$work/agentux/usr/share/cosmic/com.system76.CosmicTheme.Light"

cargo build --quiet --release --manifest-path "$here/Cargo.toml"
XDG_DATA_DIRS="$work/agentux/usr/share" XDG_CONFIG_HOME="$work/out"     "$here/target/release/agentux-cosmic-theme-gen"

ok=1
for theme in com.system76.CosmicTheme.Dark com.system76.CosmicTheme.Light; do
    # The schema version this COSMIC reads (the generator may leave older ones).
    out=$(ls "$work/out/cosmic/$theme" | sort -V | tail -n 1)
    for built in "$work/out/cosmic/$theme/$out"/*; do
        shipped="usr/share/cosmic/$theme/$out/$(basename "$built")"
        [[ -f "$shipped" ]] && node "$here/same.mjs" "$built" "$shipped" && continue
        if [[ "$write" == 1 ]]; then
            install -D -m 0644 "$built" "$shipped"; echo "wrote $shipped"
        else
            echo "::error::$shipped is not what the AgentUX builders give (run tools/cosmic-theme/theme.sh --write)"
            [[ -f "$shipped" ]] && { diff "$shipped" "$built" || true; }
            ok=0
        fi
    done
    for shipped in "usr/share/cosmic/$theme"/*/*; do
        [[ -e "$shipped" ]] || continue
        [[ "$shipped" == "usr/share/cosmic/$theme/$out/"* && -f "$work/out/cosmic/$theme/$out/$(basename "$shipped")" ]] && continue
        if [[ "$write" == 1 ]]; then
            rm "$shipped"; echo "removed $shipped"
        else
            echo "::error::$shipped is not part of the built theme; drop it"; ok=0
        fi
    done
done
[[ "$ok" == 1 ]]
echo 'COSMIC themes: OK'
