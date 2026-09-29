
const vm = require("vm");
const source = "\n    (() => {\n      const STEP_PX = 400;\n      const SCANNER_SEL = '[data-test-id*=\"virtuoso-scroller\"], [class*=\"virtuoso-scroller\"]';\n      const TRACK_LIKE = '[class*=\"CommonTrack_root\"], [class*=\"TrackPlaylist_important\"]';\n      const playlist = document.getElementById(\"playlist\");\n\n      // 40 rows (more than the 9 the walk currently reports - byte-verbatim \"i dont see first songs\"):\n      for (let i = 1; i <= 40; i += 1) {\n        const row = document.createElement(\"div\");\n        row.className = \"CommonTrack_root TrackPlaylist_important\";\n        row.innerHTML =\n          '<div class=\"Meta_title\">song ' + i + '</div>' +\n          '<div class=\"Meta_artists\">artist ' + (i % 5 + 1) + '</div>' +\n          '<div class=\"Meta_albumLink\">album ' + (i % 3 + 1) + '</div>' +\n          '<div class=\"CommonControlsBar_duration\">0' + (i % 5) + ':' +\n          String(i % 60).padStart(2, \"0\") + '</div>';\n        playlist.appendChild(row);\n      }\n\n      const seenOnce = () => {\n        const out = [];\n        const uniq = new Set();\n        for (const r of document.querySelectorAll(TRACK_LIKE)) {\n          const t = r.querySelector(\".Meta_title\")?.textContent?.trim() ?? \"\";\n          if (!t) continue;\n          if (uniq.has(t)) continue;\n          uniq.add(t);\n          out.push({ title: t });\n        }\n        return out;\n      };\n\n      // walk THE walk: first-screen at scrollTop 0 first, then 400px moves, SCAN_STEP per move naming each parsed song.\n      const scroller = document.querySelector(SCANNER_SEL);\n      const moves = [];\n      const grownSteps = [];\n      const result = [];\n      scroller.scrollTop = 0; Wait;\n      const firstScreen = seenOnce();\n      result.push(...firstScreen);\n      grownSteps.push(result.length);\n      console.log(\"parsed \" + JSON.stringify(firstScreen[0].title));\n      console.log(\"parsed \" + JSON.stringify(firstScreen[1].title));\n      window.dispatchEvent(new CustomEvent(\"SCAN_STEP\", {\n        detail: { step: 0, total: result.length, scrollTop: scroller.scrollTop, names: firstScreen.map((t) => t.title) }\n      }));\n\n      const maxSteps = Math.ceil((scroller.scrollHeight - scroller.clientHeight) / STEP_PX) + 3;\n      let steps = 0;\n      const tick = async () => {\n        await new Promise((r) => setTimeout(r, 60));\n        if (steps < maxSteps && scroller.scrollTop + scroller.clientHeight < scroller.scrollHeight) {\n          const prev = scroller.scrollTop;\n          scroller.scrollTop = Math.min(prev + STEP_PX, scroller.scrollHeight);\n          moves.push(scroller.scrollTop - prev);\n          const fresh = seenOnce();\n          for (const s of fresh) {\n            if (!result.some((x) => x.title === s.title)) {\n              result.push(s);\n              console.log(\"parsed \" + JSON.stringify(s.title));\n            }\n          }\n          grownSteps.push(result.length);\n          window.dispatchEvent(new CustomEvent(\"SCAN_STEP\", {\n            detail: { step: steps + 1, total: result.length, scrollTop: scroller.scrollTop, names: fresh.map((t) => t.title) }\n          }));\n          steps += 1;\n          return tick();\n        }\n        window.__moves = moves;\n        window.__grownSteps = grownSteps;\n        window.__result = result;\n        window.__walkDone = true;\n      };\n      tick();\n    })();\n  ";

const scrollerEl = {
  scrollTop: 0, clientHeight: 480, scrollHeight: 52 * 40 + 4, addEventListener() {},
};
let appended = 0;
const playlistEl = { appendChild() { appended += 1; } };
const rows = [];
for (let i = 1; i <= 40; i += 1) rows.push({
  title: "song " + i,
  artists: ["artist " + (i % 5 + 1)],
  album: "album " + (i % 3 + 1),
  querySelector(sel) {
    const s = String(sel);
    if (s.includes("Meta_title")) return { textContent: this.title };
    if (s.includes("Meta_artists")) return { textContent: this.artists.join(", ") };
    if (s.includes("Meta_albumLink")) return { textContent: this.album };
    return null;
  },
});
const document = {
  querySelectorAll(sel) {
    const s = String(sel);
    return (s.includes("CommonTrack_root") || s.includes("TrackPlaylist")) ? rows : [];
  },
  querySelector(sel) {
    const s = String(sel);
    if (s.includes("virtuoso-scroller")) return scrollerEl;
    if (s === "#playlist" || s.includes("playlist")) return playlistEl;
    return null;
  },
};
const dev = { postMessage() {}, runtime: { onMessage: () => ({ on(){}, remove(){} }) } };
const sandbox = {
  document, window: {}, chrome: dev, console, Math, String,
  CustomEvent: class { constructor(t, o){ this.type = t; if (o && o.detail) Object.assign(this, o.detail); } },
  setTimeout, clearTimeout, setInterval, clearInterval,
};
vm.createContext(sandbox);
try {
  vm.runInContext(source, sandbox, { filename: "fixture.sandbox.js" });
  setTimeout(() => {
    const info = vm.runInContext("window.__result ? window.__result.length : 'n/a'", sandbox);
    console.log("HARNESS appended=" + appended + " resultLen=" + JSON.stringify(info));
  }, 3000);
} catch (e) {
  console.log("RED " + String(e && e.message).slice(0, 180));
}
