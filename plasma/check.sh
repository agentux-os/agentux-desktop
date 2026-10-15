#!/usr/bin/env bash
# Static checks for the Plasma defaults overlay in this directory.
# Needs: desktop-file-validate (desktop-file-utils), node, xmllint (libxml2).
# Optional: qmllint (qt6-qtdeclarative-devel), to check the splash QML;
# setpriv (util-linux), when run as root, to test the cockpit autostart wrapper
# as both a system and a regular user.
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

# 9. Shell scripts: executable, and their shell's syntax (POSIX sh unless the
#    shebang says bash).
while IFS= read -r -d '' file; do
    shell=sh
    [[ "$(head -n 1 "$file")" == '#!/usr/bin/bash' ]] && shell=bash
    echo "$shell -n $file"
    [[ -x "$file" ]] || err "$file is not executable (git add --chmod=+x)"
    "$shell" -n "$file" || err "$file has a shell syntax error"
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

# 13. Wallpaper packages with a dark variant: Plasma picks contents/images_dark/
#     for dark colour schemes and contents/images/ otherwise, by the size closest
#     to the screen. Both must exist and offer the same sizes.
while IFS= read -r -d '' dark; do
    pkg=${dark%/images_dark}
    echo "wallpaper variants $pkg"
    [[ -d "$pkg/images" ]] || { err "$pkg has images_dark/ but no images/"; continue; }
    light_list=$(cd "$pkg/images" && ls | sort)
    dark_list=$(cd "$dark" && ls | sort)
    [[ -n "$dark_list" ]] || err "$dark is empty"
    [[ "$light_list" == "$dark_list" ]] || err "$pkg: images/ and images_dark/ offer different files"
done < <(find usr/share/wallpapers -type d -name images_dark -print0 2>/dev/null)

# 14. Login splash: /etc/xdg/ksplashrc and the global theme's defaults must pick
#     the global theme's own splash, and that package must ship
#     contents/splash/Splash.qml with every image it loads, at 1x and @2x and
#     at the pixel sizes its `px` table lays them out with (the water sheet is
#     5 x 5 frames), and nothing in images/ it does not load.
#     With qmllint (qt6-qtdeclarative-devel), the QML is checked for syntax too.
lnf_dir="usr/share/plasma/look-and-feel/${lnf}"
splash_theme=$(sed -n '/^\[KSplash\]$/,/^\[/s/^Theme=//p' etc/xdg/ksplashrc 2>/dev/null)
[[ "$splash_theme" == "$lnf" ]] \
    || err "etc/xdg/ksplashrc must set [KSplash] Theme=${lnf} (has '${splash_theme}')"
defaults_theme=$(sed -n '/^\[ksplashrc\]\[KSplash\]$/,/^\[/s/^Theme=//p' "$lnf_dir/contents/defaults")
[[ "$defaults_theme" == "$lnf" ]] \
    || err "$lnf_dir/contents/defaults must set [ksplashrc][KSplash] Theme=${lnf} (has '${defaults_theme}')"
splash="$lnf_dir/contents/splash/Splash.qml"
if [[ -f "$splash" ]]; then
    echo "splash $splash"
    node -e '
        const fs = require("fs"), path = require("path");
        const [qml, dir] = process.argv.slice(1);
        const text = fs.readFileSync(qml, "utf8");
        const table = text.match(/property var px: \(\{([^}]*)\}\)/);
        if (!table) { console.error("error: " + qml + " has no px table"); process.exit(1); }
        const sizes = {};
        for (const m of table[1].matchAll(/"([a-z-]+)": \[(\d+), (\d+), (\d+), (\d+)\]/g))
            sizes[m[1]] = m.slice(2).map(Number);
        const sheet = { water: 5 }; // frames per row and per column
        let bad = 0;
        const fail = (msg) => { console.error("error: " + msg); bad = 1; };
        if (!Object.keys(sizes).length) fail(qml + ": empty px table");
        for (const [name, s] of Object.entries(sizes)) {
            for (const [variant, w, h] of [["", s[0], s[1]], ["@2x", s[2], s[3]]]) {
                const file = path.join(dir, name + variant + ".png");
                if (!fs.existsSync(file)) { fail(qml + " loads " + name + variant + ".png, which is not in the package"); continue; }
                const png = fs.readFileSync(file);
                const k = sheet[name] || 1;
                const [fw, fh] = [png.readUInt32BE(16), png.readUInt32BE(20)];
                if (fw !== w * k || fh !== h * k)
                    fail(file + " is " + fw + "x" + fh + ", " + qml + " expects " + w * k + "x" + h * k);
            }
        }
        for (const file of fs.readdirSync(dir)) {
            const name = file.replace(/(@2x)?\.png$/, "");
            if (!(name in sizes)) fail(path.join(dir, file) + " is not used by " + qml);
        }
        process.exit(bad);
    ' "$splash" "$lnf_dir/contents/splash/images" || err "$splash and its images do not match"
    if command -v qmllint >/dev/null || [[ -x /usr/lib64/qt6/bin/qmllint ]]; then
        qmllint_bin=$(command -v qmllint || echo /usr/lib64/qt6/bin/qmllint)
        "$qmllint_bin" "$splash" || err "$splash failed qmllint"
    else
        echo "  qmllint skipped (not installed)"
    fi
else
    err "the global theme ${lnf} ships no splash ($splash)"
fi

# 15. The welcome wizard's backend: the catalog parses, `agentux-setup plan`
#     prints the expected commands and refuses what it does not know, the
#     VS Code settings merge keeps the user's own keys, `status` prints JSON,
#     and the first-run marker decides whether the login autostart opens the
#     wizard (not for system users, not on the live ISO, not twice).
setup=usr/libexec/agentux-setup
catalog=usr/share/agentux/setup/catalog.json
if [[ -f "$setup" ]]; then
    echo "behaviour $setup"
    node -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))' "$catalog" || err "$catalog is not valid JSON"
    grep -q '^Url=https://dl.flathub.org/repo/$' usr/share/agentux/setup/flathub.flatpakrepo         && grep -q '^GPGKey=' usr/share/agentux/setup/flathub.flatpakrepo         || err "usr/share/agentux/setup/flathub.flatpakrepo is not Flathub's repo file"
    if command -v jq >/dev/null; then
        tmp=$(mktemp -d)
        chmod 0755 "$tmp"
        echo 'VERSION_ID=44' > "$tmp/os-release"
        export AGENTUX_SETUP_CATALOG="$PWD/$catalog" AGENTUX_OS_RELEASE="$tmp/os-release"
        out=$(bash "$setup" install --dry-run vscode java@temurin-17 intellij-idea elixir 2>&1) || err "$setup install --dry-run failed: $out"
        expected=$(printf '%s	%s
'             vscode "flatpak remote-add --user --if-not-exists flathub /usr/share/agentux/setup/flathub.flatpakrepo"             vscode "flatpak install --user --noninteractive --or-update flathub com.visualstudio.code"             vscode "flatpak override --user --talk-name=org.freedesktop.Flatpak --filesystem=home com.visualstudio.code"             vscode "agentux-setup vscode-settings com.visualstudio.code .var/app/com.visualstudio.code/config/Code/User"             vscode "agentux-setup vscode-sdks"             java "mise use --global java@temurin-17"             java "agentux-setup vscode-sdks"             intellij-idea "agentux-setup jetbrains-toolbox"             elixir "agentux-setup distrobox-create fedora-dev registry.fedoraproject.org/fedora-toolbox:44"             elixir "distrobox enter -T fedora-dev -- sudo dnf -y install elixir erlang")
        [[ "$out" == "$expected" ]] || err "$setup plan printed:"$'
'"$out"$'
'"expected:"$'
'"$expected"
        bash "$setup" plan no-such-item >/dev/null 2>&1 && err "$setup plan accepted an unknown item"
        bash "$setup" plan 'java@$(id)' >/dev/null 2>&1 && err "$setup plan accepted a version with shell syntax"

        # VS Code settings: defaults added, the user's keys kept.
        settings="$tmp/home/.var/app/com.visualstudio.code/config/Code/User/settings.json"
        mkdir -p "$(dirname "$settings")"
        echo '{"editor.fontSize": 15, "terminal.integrated.defaultProfile.linux": "zsh"}' > "$settings"
        HOME="$tmp/home" XDG_DATA_HOME="$tmp/home/.local/share" bash "$setup" vscode-settings com.visualstudio.code             .var/app/com.visualstudio.code/config/Code/User >/dev/null || err "$setup vscode-settings failed"
        jq -e '."editor.fontSize" == 15 and ."terminal.integrated.defaultProfile.linux" == "zsh"
               and ."terminal.integrated.profiles.linux"."host bash".path == "/usr/bin/flatpak-spawn"
               and (."terminal.integrated.profiles.linux"."host bash".args | index("--host"))
               and (."dev.containers.dockerPath" | endswith("/agentux/bin/podman-host"))' "$settings" >/dev/null             || err "$setup vscode-settings did not merge as expected: $(cat "$settings")"
        [[ -x "$tmp/home/.local/share/agentux/bin/podman-host" ]] || err "$setup vscode-settings wrote no podman-host wrapper"

        HOME="$tmp/home" bash "$setup" status | jq -e '.items == {} and (.agents | length == 4) and (.firstLogin | has("done"))' >/dev/null             || err "$setup status did not print the expected JSON"

        # A batch run for real with a stub flatpak: one item done, one failed
        # (the stub fails for Slack), and `status` reports both, with their
        # last log line and no version.
        mkdir -p "$tmp/stub"
        printf '#!/bin/sh\ncase "$*" in *com.slack.Slack*) echo "error: no route to Flathub" >&2; exit 1 ;; esac\necho "flatpak $*"\n' > "$tmp/stub/flatpak"
        chmod 0755 "$tmp/stub/flatpak"
        HOME="$tmp/batch" PATH="$tmp/stub:$PATH" bash "$setup" install flatseal slack >/dev/null 2>&1 \
            && err "$setup install reported success with a failed item"
        HOME="$tmp/batch" PATH="$tmp/stub:$PATH" bash "$setup" status \
            | jq -e '.items.flatseal.state == "done" and .items.flatseal.version == "" and (.items.flatseal.updated > 0)
                     and .items.slack.state == "failed" and (.items.slack.message | test("no route to Flathub"))' >/dev/null \
            || err "$setup status after a batch: $(HOME="$tmp/batch" PATH="$tmp/stub:$PATH" bash "$setup" status 2>&1)"
        grep -q 'flatpak install --user --noninteractive --or-update flathub com.github.tchx84.Flatseal' "$tmp/batch/.local/state/agentux/setup/logs/flatseal.log" \
            || err "$setup install wrote no log for flatseal"

        # First-run marker and autostart, for a regular user (needs root and setpriv).
        if [[ "$(id -u)" == 0 ]] && command -v setpriv >/dev/null; then
            mkdir -p "$tmp/user" "$tmp/bin"
            chown 4242:4242 "$tmp/user"
            printf '#!/bin/sh
echo "started $*" > "%s/user/cockpit"
' "$tmp" > "$tmp/bin/agentux-cockpit"
            chmod 0755 "$tmp/bin/agentux-cockpit"
            cp "$setup" "$tmp/bin/agentux-setup"
            chmod 0755 "$tmp/bin/agentux-setup"
            as() { # uid, live marker, args...
                local uid=$1 live=$2; shift 2
                setpriv --reuid="$uid" --regid="$uid" --clear-groups env -i HOME="$tmp/user" PATH="$tmp/bin:/usr/bin:/bin"                     AGENTUX_LIVE_MARKER="$live" "$tmp/bin/agentux-setup" "$@"
            }
            as 4242 /nonexistent should-run 2>/dev/null || err "should-run said no for a new regular user"
            as 968 /nonexistent should-run 2>/dev/null && err "should-run said yes for a system user"
            as 4242 "$tmp/os-release" should-run 2>/dev/null && err "should-run said yes on the live system"
            as 4242 /nonexistent autostart
            [[ "$(cat "$tmp/user/cockpit" 2>/dev/null)" == "started --welcome" ]] || err "autostart did not run agentux-cockpit --welcome"
            rm -f "$tmp/user/cockpit"
            as 4242 /nonexistent finish || err "finish failed"
            [[ -e "$tmp/user/.local/state/agentux/welcome.done" ]] || err "finish wrote no marker"
            as 4242 /nonexistent should-run 2>/dev/null && err "should-run said yes after finish"
            as 4242 /nonexistent autostart
            [[ ! -e "$tmp/user/cockpit" ]] || err "autostart opened the wizard again after finish"
            as 4242 /nonexistent reset && as 4242 /nonexistent should-run 2>/dev/null || err "should-run said no after reset"
        else
            echo "  first-run marker cases skipped (need root and setpriv)"
        fi
        unset AGENTUX_SETUP_CATALOG AGENTUX_OS_RELEASE
        rm -rf "$tmp"
    else
        echo "  agentux-setup behaviour skipped (jq not installed)"
    fi
fi

if (( fail )); then
    echo "plasma overlay: FAILED" >&2
    exit 1
fi
echo "plasma overlay: OK"
