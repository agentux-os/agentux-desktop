/*
    AgentUX login splash (KSplash), shown while Plasma starts.

    It continues the boot splash agentux-os ships (Plymouth theme "agentux",
    files/usr/share/plymouth/themes/agentux/agentux.script): the swimming
    penguin in Lime with the wordmark in Mist below it on Ink, the same light
    running back along the wake, and the same progress water line, a Lime
    wave filling a Graphite one. Sizes and positions follow agentux.script
    (they are for 1080p and scale with the screen), and images/ holds that
    theme's PNGs unchanged, at 1x and @2x; regenerate them there (plymouth/
    build.py in agentux-os) and copy them over, rather than editing them here.

    ksplashqml sets `stage` as Plasma starts (1 to 5 in Plasma 6; Breeze
    treats 5 as "nearly done"), which drives the progress line.
*/

import QtQuick
import QtQuick.Window

Rectangle {
    id: root
    color: "#0b0d10" // Ink

    property int stage

    // agentux.script: scale = clamp(min(W / 1920, H / 1080), 0.75, 4), in
    // device pixels; QML works in logical pixels, so the device pixel ratio
    // only decides which image set is sharp enough.
    readonly property real s: Math.max(0.75, Math.min(4, Math.min(width / 1920, height / 1080)))
    readonly property string suffix: s * Screen.devicePixelRatio > 1.4 ? "@2x" : ""
    readonly property real progress: Math.max(0, Math.min(1, stage / 5))

    // Image sizes at 1x (1080p), as agentux.script loads them.
    readonly property size markSize: Qt.size(256, 90)
    readonly property size wordmarkSize: Qt.size(136, 30)
    readonly property size trackSize: Qt.size(136, 8)

    // The wake animation: FRAMES frames of COLUMNS per row, 25 fps, then
    // PAUSE frames at rest.
    readonly property int frames: 45
    readonly property int columns: 5
    readonly property int pause: 30
    property int frame: 0

    Item {
        id: content
        anchors.fill: parent
        opacity: 0

        // The mark and the wordmark 28 px apart, the group centred at 47 %
        // of the height; the progress line 40 px under the wordmark.
        readonly property real groupHeight: (root.markSize.height + 28 + root.wordmarkSize.height) * root.s
        readonly property real groupTop: Math.floor(root.height * 0.47 - groupHeight / 2)

        Image {
            id: mark
            x: Math.floor(root.width / 2 - width / 2)
            y: content.groupTop
            width: root.markSize.width * root.s
            height: root.markSize.height * root.s
            source: "images/mark" + root.suffix + ".png"
            smooth: true
            mipmap: true
        }

        // One frame of the wake sprite sheet, drawn over the mark.
        Item {
            x: mark.x
            y: mark.y
            width: mark.width
            height: mark.height
            clip: true
            visible: root.frame < root.frames

            Image {
                width: mark.width * root.columns
                height: mark.height * Math.ceil(root.frames / root.columns)
                x: -(root.frame % root.columns) * mark.width
                y: -Math.floor(root.frame / root.columns) * mark.height
                source: "images/wake" + root.suffix + ".png"
                smooth: true
                mipmap: true
            }
        }

        Image {
            id: wordmark
            x: Math.floor(root.width / 2 - width / 2)
            y: Math.floor(content.groupTop + (root.markSize.height + 28) * root.s)
            width: root.wordmarkSize.width * root.s
            height: root.wordmarkSize.height * root.s
            source: "images/wordmark" + root.suffix + ".png"
            smooth: true
            mipmap: true
        }

        Image {
            id: track
            x: Math.floor(root.width / 2 - width / 2)
            y: Math.floor(wordmark.y + wordmark.height + 40 * root.s)
            width: root.trackSize.width * root.s
            height: root.trackSize.height * root.s
            source: "images/track" + root.suffix + ".png"
            smooth: true
            mipmap: true

            // The Lime wave cut to the progress, not squeezed: the water
            // line fills from the left.
            Item {
                id: fillClip
                width: track.width * root.progress
                height: track.height
                clip: true

                Behavior on width {
                    NumberAnimation { duration: 600; easing.type: Easing.OutCubic }
                }

                Image {
                    width: track.width
                    height: track.height
                    source: "images/fill" + root.suffix + ".png"
                    smooth: true
                    mipmap: true
                }
            }
        }
    }

    Timer {
        interval: 40 // 25 fps
        repeat: true
        running: true
        onTriggered: root.frame = (root.frame + 1) % (root.frames + root.pause)
    }

    OpacityAnimator {
        target: content
        from: 0
        to: 1
        duration: 500
        easing.type: Easing.InOutQuad
        running: true
    }
}
