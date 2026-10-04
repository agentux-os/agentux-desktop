#!/usr/bin/env bash
# Static checks for the Plasma defaults overlay in this directory.
# Needs: desktop-file-validate (desktop-file-utils), node, xmllint (libxml2).
# Optional: setpriv (util-linux), when run as root, to test the cockpit
# autostart wrapper as both a system and a regular user.
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

# 8. Exec= targets under /usr/libexec/agentux-* are ours: they must ship in the
#    overlay, executable.
while IFS= read -r -d '' file; do
    while IFS= read -r target; do
        case "$target" in
            /usr/libexec/agentux-*)
                [[ -f ".${target}" ]] || err "$file: Exec target is not in the overlay: $target"
                [[ -x ".${target}" ]] || err "$file: Exec target is not executable: $target (git add --chmod=+x)"
                ;;
        esac
    done < <(sed -n 's/^Exec=\([^[:space:]]*\).*/\1/p' "$file")
done < <(find usr etc -type f -name '*.desktop' -print0)

# 9. Shell scripts: executable, POSIX sh syntax.
while IFS= read -r -d '' file; do
    echo "sh -n $file"
    [[ -x "$file" ]] || err "$file is not executable (git add --chmod=+x)"
    sh -n "$file" || err "$file has a shell syntax error"
done < <(find usr/libexec -type f -print0 2>/dev/null)

# 10. The cockpit autostart wrapper skips system users (the first-boot wizard
#     runs a Plasma session as the plasma-setup system user, UID 968) and execs
#     the cockpit with its arguments for everyone else. A stub agentux-cockpit
#     on PATH records the call. Run as root with setpriv, both cases are tested;
#     otherwise only the one that matches the current user.
wrapper=usr/libexec/agentux-cockpit-autostart
if [[ -f "$wrapper" ]]; then
    echo "behaviour $wrapper"
    tmp=$(mktemp -d)
    cp "$wrapper" "$tmp/wrapper"
    printf '#!/bin/sh\necho "started $*" > "%s/out-$(id -u)"\n' "$tmp" > "$tmp/agentux-cockpit"
    chmod 755 "$tmp/wrapper" "$tmp/agentux-cockpit"
    chmod 1777 "$tmp" # the stub writes its marker as the test uid

    me=$(id -u)
    if [[ "$me" == 0 ]] && command -v setpriv >/dev/null; then
        system_uid=968 user_uid=4242
    elif (( me < 1000 )); then
        system_uid=$me user_uid=
        echo "  regular-user case skipped (needs root and setpriv)"
    else
        system_uid= user_uid=$me
        echo "  system-user case skipped (needs root and setpriv)"
    fi
    run_as() { # uid, args...
        local uid=$1; shift
        if [[ "$uid" == "$me" ]]; then
            env PATH="$tmp:$PATH" "$tmp/wrapper" "$@"
        else
            setpriv --reuid="$uid" --regid="$uid" --clear-groups env PATH="$tmp:$PATH" "$tmp/wrapper" "$@"
        fi
    }

    if [[ -n "$system_uid" ]]; then
        run_as "$system_uid" 2>/dev/null || err "$wrapper exited non-zero for system uid $system_uid"
        [[ ! -e "$tmp/out-$system_uid" ]] || err "$wrapper started the cockpit for system uid $system_uid"
    fi
    if [[ -n "$user_uid" ]]; then
        run_as "$user_uid" --flag || err "$wrapper failed for uid $user_uid"
        [[ "$(cat "$tmp/out-$user_uid" 2>/dev/null)" == "started --flag" ]] \
            || err "$wrapper did not exec agentux-cockpit with its arguments for uid $user_uid"
    fi
    rm -rf "$tmp"
fi

# 11. Welcome Center: kded autoloads its launcher module unless kded5rc turns it
#     off. The group name is the plugin id (kded_plasma_welcome.so, plasma-welcome).
if [[ -f etc/xdg/kded5rc ]]; then
    sed -n '/^\[Module-kded_plasma_welcome\]$/,/^\[/p' etc/xdg/kded5rc | grep -qx 'autoload=false' \
        || err "etc/xdg/kded5rc must set [Module-kded_plasma_welcome] autoload=false"
fi

# 12. Plasma Login parses every file in /usr/lib/plasmalogin/plasmalogin.conf.d
#     as configuration, so only .conf files may go there.
while IFS= read -r -d '' file; do
    [[ "$file" == *.conf ]] || err "unexpected file in the Plasma Login drop-in directory: $file"
done < <(find usr/lib/plasmalogin -type f -print0 2>/dev/null)

if (( fail )); then
    echo "plasma overlay: FAILED" >&2
    exit 1
fi
echo "plasma overlay: OK"
