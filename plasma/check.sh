#!/usr/bin/env bash
# Static checks for the Plasma defaults overlay in this directory.
# Needs: desktop-file-validate (desktop-file-utils), node, xmllint (libxml2).
# Usage: plasma/check.sh   (from anywhere)
set -euo pipefail

cd "$(dirname "$0")"
fail=0
err() { echo "error: $*" >&2; fail=1; }

for tool in desktop-file-validate node xmllint; do
    command -v "$tool" >/dev/null || { echo "error: $tool not found" >&2; exit 2; }
done

# 1. Overlay layout: only /usr and /etc, nothing that lands in a home directory.
#    /etc/skel is refused too: it is copied into ~ when an account is created.
for entry in *; do
    case "$entry" in
        usr | etc) ;;
        check.sh) ;;
        *) [[ -d "$entry" ]] && err "unexpected top-level overlay directory: /$entry" ;;
    esac
done
while IFS= read -r -d '' path; do
    rel="${path#./}"
    case "/$rel" in
        /home | /home/* | /root | /root/* | /var/home | /var/home/* | /var/roothome | /var/roothome/* | /etc/skel | /etc/skel/*)
            err "overlay path under a home directory: /$rel" ;;
    esac
done < <(find . -mindepth 1 -print0)

# 2. Desktop entries.
while IFS= read -r -d '' file; do
    echo "desktop-file-validate $file"
    desktop-file-validate "$file" || err "$file failed desktop-file-validate"
done < <(find usr etc -type f -name '*.desktop' -print0)

# 3. Plasma scripts: syntax only (the Plasma scripting globals are not defined in node).
while IFS= read -r -d '' file; do
    echo "node --check $file"
    node --check "$file" || err "$file has a JavaScript syntax error"
done < <(find usr -type f -path '*/contents/layouts/*.js' -print0)

# 4. KPackage metadata must be valid JSON with a KPlugin.Id.
while IFS= read -r -d '' file; do
    echo "json $file"
    node -e '
        const m = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
        if (!m.KPlugin || !m.KPlugin.Id) { console.error("missing KPlugin.Id"); process.exit(1); }
    ' "$file" || err "$file is not valid package metadata"
done < <(find usr -type f -name metadata.json -print0)

# 5. SVGs must be well-formed XML (Qt's SVG renderer rejects anything else).
while IFS= read -r -d '' file; do
    echo "xmllint $file"
    xmllint --noout "$file" || err "$file is not well-formed XML"
done < <(find usr -type f -name '*.svg' -print0)

# 6. Every file:///usr/... the overlay points at must ship in the overlay.
while IFS= read -r ref; do
    target="${ref#file://}"
    [[ -e ".${target}" ]] || err "referenced path is not in the overlay: $target"
done < <(grep -rhoE 'file:///usr/[^"[:space:]]+' usr etc | sort -u)

# 7. The global theme id must match what /etc/xdg/kdeglobals selects.
lnf=$(sed -n 's/^LookAndFeelPackage=//p' etc/xdg/kdeglobals)
[[ -f "usr/share/plasma/look-and-feel/${lnf}/metadata.json" ]] \
    || err "kdeglobals selects LookAndFeelPackage=${lnf}, which the overlay does not ship"

if (( fail )); then
    echo "plasma overlay: FAILED" >&2
    exit 1
fi
echo "plasma overlay: OK"
