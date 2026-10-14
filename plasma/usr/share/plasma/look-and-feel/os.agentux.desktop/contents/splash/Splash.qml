pragma ComponentBehavior: Bound

/*
    AgentUX login splash (KSplash), shown while Plasma starts.

    It continues the boot splash agentux-os ships (Plymouth theme "agentux",
    files/usr/share/plymouth/themes/agentux/agentux.script) as one scene: the
    swimming penguin on Ink, bobbing and pitching with the bob, its flipper
    stroking, the water of its wake streaming back and bubbles rising from its
    back; the wordmark in Mist below it, and the progress water line, a Lime
    wave filling a Graphite one. Layout and motion follow agentux.script's
    layout() and swim() step by step, with its constants copied below, and
    images/ holds that theme's PNGs unchanged, at 1x (1080p) and @2x.
    Regenerate them there (plymouth/build.py in agentux-os) and copy them, and
    the constants, over rather than editing them here.

    ksplashqml sets `stage` as Plasma starts (1 to 5 in Plasma 6; Breeze
    treats 5 as "nearly done"), which drives the progress line.
*/

import QtQuick
import QtQuick.Window

Rectangle {
    id: root
    color: "#0b0d10" // Ink

    property int stage
    readonly property real progress: Math.max(0, Math.min(1, stage / 5))

    // From agentux.script's generated block: the moving parts' geometry in
    // 1080p pixels from the mark's top-left corner (the mark is 256 px wide).
    readonly property real markH: 89.95
    readonly property point pivot: Qt.point(173.68, 45.04)   // penguin.png's centre
    readonly property point root_: Qt.point(150.05, 61.42)   // flipper.png's centre
    readonly property point waterAt: Qt.point(0.0, 12.3)     // water frames' top-left
    readonly property var spawns: [Qt.point(121.29, 30.54), Qt.point(113.8, 22.12), Qt.point(108.19, 38.03)]
    readonly property int frames: 25    // water.png: 25 frames,
    readonly property int columns: 5    // 5 per row

    // agentux.script's motion, in its 50 Hz ticks.
    readonly property int cycle: 200          // a bob, its pitch and two flipper strokes (4 s)
    readonly property real bobAmp: 3
    readonly property real pitchAmp: 0.026    // radians
    readonly property real flapAmp: 0.14      // radians, twice per cycle
    readonly property int bubbleCount: 4
    readonly property int bubbleEvery: 25     // ticks between two bubbles
    readonly property int bubbleLife: 100     // ticks a bubble lives
    readonly property real bubbleVx: 42       // px/s backwards
    readonly property real bubbleVy: 8        // px/s upwards
    readonly property real bubbleWobble: 2
    readonly property real bubbleAlpha: 0.55

    // The images' pixel sizes, 1x then @2x (checked against the files by
    // plasma/check.sh); the water's are one frame of the sheet.
    readonly property var px: ({
        "penguin": [176, 101, 352, 203],
        "flipper": [129, 129, 258, 258],
        "water": [153, 67, 305, 135],
        "bubble": [10, 10, 18, 18],
        "bubble-small": [6, 6, 9, 9],
        "wordmark": [136, 30, 272, 60],
        "track": [136, 8, 272, 16],
        "fill": [136, 8, 272, 16]
    })

    // agentux.script: scale = clamp(min(W / 1920, H / 1080), 0.75, 4) in
    // device pixels; the @2x set above 1.4. QML works in logical pixels.
    readonly property real dpr: Screen.devicePixelRatio > 0 ? Screen.devicePixelRatio : 1
    readonly property real s: Math.max(0.75, Math.min(4, Math.min(width * dpr / 1920, height * dpr / 1080))) / dpr
    readonly property bool hi: s * dpr > 1.4
    readonly property string suffix: hi ? "@2x" : ""
    // An image's size on screen, in logical pixels, as agentux.script scales it.
    function size(name, axis) {
        const k = hi ? s * dpr / 2 : s * dpr;
        return Math.max(Math.round(px[name][axis + (hi ? 2 : 0)] * k), 1) / dpr;
    }
    function src(name) { return "images/" + name + suffix + ".png"; }

    // layout(): the mark box and the wordmark 28 px apart, centred at 47 % of
    // the height; the progress line 40 px under the wordmark.
    readonly property real markX: width / 2 - 128 * s
    readonly property real markY: height * 0.47 - (markH * s + 28 * s + size("wordmark", 1)) / 2

    // The clock: Plymouth's ticks since the splash appeared. Plymouth moves
    // the swim at 25 fps; this redraws at up to 50 fps from the same formulas.
    property real tick: 0
    property bool animate: true
    readonly property real fade: Math.max(0, Math.min(1, tick / 25))
    readonly property real a: 2 * Math.PI * (tick % cycle) / cycle
    readonly property real bob: bobAmp * s * Math.sin(a)
    readonly property real pitch: -pitchAmp * Math.cos(a)
    readonly property real flap: flapAmp * Math.sin(2 * a)

    Timer {
        property real started: 0
        interval: 20
        repeat: true
        running: root.animate
        onTriggered: {
            const now = Date.now();
            if (started === 0)
                started = now;
            root.tick = (now - started) / 20;
        }
    }

    // swim(): z order water, bubbles, penguin, flipper.

    // One frame of the water sheet, bobbing with the penguin.
    Item {
        x: Math.floor(root.markX + root.waterAt.x * root.s)
        y: Math.floor(root.markY + root.bob + root.waterAt.y * root.s)
        width: root.size("water", 0)
        height: root.size("water", 1)
        clip: true
        opacity: root.fade
        readonly property int frame: Math.floor(root.tick / 2) % root.frames

        Image {
            width: parent.width * root.columns
            height: parent.height * Math.ceil(root.frames / root.columns)
            x: -(parent.frame % root.columns) * parent.width
            y: -Math.floor(parent.frame / root.columns) * parent.height
            source: root.src("water")
            smooth: true
        }
    }

    // Bubbles are in the water: they do not bob.
    Repeater {
        model: root.bubbleCount

        Image {
            required property int index
            readonly property real age0: root.tick - index * root.bubbleEvery
            readonly property int n: Math.floor(Math.max(age0, 0) / root.bubbleLife)
            readonly property real age: age0 - n * root.bubbleLife
            readonly property point spawn: root.spawns[(n + index) % 3]
            readonly property string kind: (n + index) % 2 === 0 ? "bubble" : "bubble-small"
            readonly property real life: age / root.bubbleLife

            visible: age0 >= 0
            width: root.size(kind, 0)
            height: root.size(kind, 1)
            x: Math.floor(root.markX + (spawn.x - root.bubbleVx * age / 50) * root.s - width / 2)
            y: Math.floor(root.markY + (spawn.y - root.bubbleVy * age / 50
                          + root.bubbleWobble * Math.sin(3 * Math.PI * life)) * root.s - height / 2)
            opacity: root.bubbleAlpha * Math.sin(Math.PI * life) * root.fade
            source: root.src(kind)
            smooth: true
        }
    }

    // The penguin pitches about its centre (PIVOT); Plymouth's Image.Rotate
    // and QML's rotation both turn clockwise for positive angles.
    Image {
        width: root.size("penguin", 0)
        height: root.size("penguin", 1)
        x: Math.floor(root.markX + root.pivot.x * root.s - width / 2)
        y: Math.floor(root.markY + root.bob + root.pivot.y * root.s - height / 2)
        rotation: root.pitch * 180 / Math.PI
        opacity: root.fade
        source: root.src("penguin")
        smooth: true
        antialiasing: true
    }

    // The flipper strokes about its root (ROOT), on top of the pitch.
    Image {
        width: root.size("flipper", 0)
        height: root.size("flipper", 1)
        x: Math.floor(root.markX + root.root_.x * root.s - width / 2)
        y: Math.floor(root.markY + root.bob + root.root_.y * root.s - height / 2)
        rotation: (root.pitch + root.flap) * 180 / Math.PI
        opacity: root.fade
        source: root.src("flipper")
        smooth: true
        antialiasing: true
    }

    Image {
        id: wordmark
        width: root.size("wordmark", 0)
        height: root.size("wordmark", 1)
        x: Math.floor(root.width / 2 - width / 2)
        y: Math.floor(root.markY + root.markH * root.s + 28 * root.s)
        opacity: root.fade
        source: root.src("wordmark")
        smooth: true
    }

    Image {
        id: track
        width: root.size("track", 0)
        height: root.size("track", 1)
        x: Math.floor(root.width / 2 - width / 2)
        y: Math.floor(root.markY + root.markH * root.s + 28 * root.s + wordmark.height + 40 * root.s)
        source: root.src("track")
        smooth: true

        // The Lime wave cut to the progress, not squeezed: the water line
        // fills from the left.
        Item {
            width: Math.floor(track.width * root.progress)
            height: track.height
            clip: true

            Behavior on width {
                enabled: root.animate
                NumberAnimation { duration: 600; easing.type: Easing.OutCubic }
            }

            Image {
                width: track.width
                height: track.height
                source: root.src("fill")
                smooth: true
            }
        }
    }
}
