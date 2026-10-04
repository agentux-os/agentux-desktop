// AgentUX default desktop layout (Plasma 6 desktop scripting API:
// https://develop.kde.org/docs/plasma/scripting/).
//
// plasmashell runs this once, when a user has no
// ~/.config/plasma-org.kde.plasma.desktop-appletsrc yet (first login), or when
// the user applies the AgentUX global theme with "Desktop and window layout"
// ticked. It never touches an existing layout on its own.
//
// Based on plasma-desktop's layout-templates/org.kde.plasma.desktop.defaultPanel.

const wallpaper = "file:///usr/share/wallpapers/AgentUX/";

// Pinned task manager launchers: the cockpit first, then a terminal and the
// user's default browser. "applications:" entries resolve by desktop file id.
const launchers = [
    "applications:agentux-cockpit.desktop",
    "applications:org.kde.konsole.desktop",
    "preferred://browser",
];

// ---- desktops: AgentUX wallpaper on every screen of the current activity ----

const allDesktops = desktopsForActivity(currentActivity());
for (let i = 0; i < allDesktops.length; ++i) {
    const desktop = allDesktops[i];
    desktop.wallpaperPlugin = "org.kde.image";
    desktop.currentConfigGroup = ["Wallpaper", "org.kde.image", "General"];
    desktop.writeConfig("Image", wallpaper);
}

// ---- bottom panel: launcher, task manager, system tray, clock --------------

const panel = new Panel();
panel.location = "bottom";

// Same height rule as the upstream default panel: 2.5 grid units, rounded up
// to an even number of pixels.
panel.height = 2 * Math.ceil(gridUnit * 2.5 / 2);

// On ultrawide screens keep the panel at most as wide as a 21:9 monitor.
const maximumAspectRatio = 21 / 9;
const geo = screenGeometry(panel.screen);
const maximumWidth = Math.ceil(geo.height * maximumAspectRatio);
if (geo.width > maximumWidth) {
    panel.alignment = "center";
    panel.minimumLength = maximumWidth;
    panel.maximumLength = maximumWidth;
}

panel.addWidget("org.kde.plasma.kickoff");

const tasks = panel.addWidget("org.kde.plasma.icontasks");
tasks.currentConfigGroup = ["General"];
tasks.writeConfig("launchers", launchers);

panel.addWidget("org.kde.plasma.marginsseparator");

// Input method panel, for the same languages the upstream default panel adds
// it for (locales whose installs usually pull in an input method).
const inputMethodLanguages = [
    "as", "bn", "bo", "brx", "doi", "gu", "hi", "ja", "kn", "ko", "kok", "ks",
    "lep", "mai", "ml", "mni", "mr", "ne", "or", "pa", "sa", "sat", "sd", "si",
    "ta", "te", "th", "ur", "vi", "zh_CN", "zh_TW",
];
if (inputMethodLanguages.indexOf(languageId) !== -1) {
    panel.addWidget("org.kde.plasma.kimpanel");
}

panel.addWidget("org.kde.plasma.systemtray");
panel.addWidget("org.kde.plasma.digitalclock");
panel.addWidget("org.kde.plasma.showdesktop");
