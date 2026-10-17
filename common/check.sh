#!/usr/bin/env bash
# Validate desktop-neutral AgentUX integration files.
set -euo pipefail
cd "$(dirname "$0")"

fail=0
err() { echo "error: $*" >&2; fail=1; }
for tool in desktop-file-validate node; do
    command -v "$tool" >/dev/null || { echo "error: $tool not found" >&2; exit 2; }
done

for entry in *; do
    case "$entry" in usr|etc|check.sh) ;;
        *) err "unexpected common-bundle entry: $entry" ;;
    esac
done
while IFS= read -r -d '' path; do
    rel="${path#./}"
    case "/$rel" in
        /usr|/usr/*|/etc|/etc/*) ;;
        *) err "path outside install roots: $rel" ;;
    esac
    case "/$rel" in
        */kde/*|*/KDE/*|*/plasma/*|*/Plasma/*|*/cosmic/*|*/COSMIC/*|*/hyprland/*|*/Hyprland/*)
            err "desktop-specific path in common bundle: $rel" ;;
    esac
done < <(find usr etc -print0)

for script in usr/libexec/agentux-setup usr/libexec/agentux-cockpit-autostart; do
    [[ -x "$script" ]] || err "$script must be executable"
    shell=sh
    [[ "$(head -n 1 "$script" 2>/dev/null)" == '#!/usr/bin/bash' ]] && shell=bash
    "$shell" -n "$script" || err "$script has a shell syntax error"
done
node -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))' usr/share/agentux/setup/catalog.json \
    || err "setup catalog is not valid JSON"
grep -q '^Url=https://dl.flathub.org/repo/$' usr/share/agentux/setup/flathub.flatpakrepo \
    && grep -q '^GPGKey=' usr/share/agentux/setup/flathub.flatpakrepo \
    || err "Flathub repository file is incomplete"
while IFS= read -r -d '' file; do
    desktop-file-validate "$file" || err "$file failed desktop-file-validate"
done < <(find usr etc -type f -name '*.desktop' -print0)

if (( fail )); then echo 'common bundle: FAILED' >&2; exit 1; fi
echo 'common bundle: OK'
