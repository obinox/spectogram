const fileInput = document.getElementById("audioFile");
const playBtn = document.getElementById("playBtn");
const scaleRange = document.getElementById("scaleRange");
const offsetRange = document.getElementById("offsetRange");
const yScaleRange = document.getElementById("yScaleRange");
const yOffsetRange = document.getElementById("yOffsetRange");
const minDbInput = document.getElementById("minDbInput");
const maxDbInput = document.getElementById("maxDbInput");
const bpmInput = document.getElementById("bpmInput");
const gridOffsetInput = document.getElementById("gridOffsetInput");
const gridSelect = document.getElementById("gridSelect");
const highlightNoteSelect = document.getElementById("highlightNoteSelect");
const canvas = document.getElementById("spectrogramCanvas");
const ctx = canvas.getContext("2d");
const currTimeTxt = document.getElementById("currTime");
const totalTimeTxt = document.getElementById("totalTime");
const viewContainer = document.getElementById("viewContainer");

let audioCtx;
let audioBuf;
let source;
let fftData = [];
let startTime = 0;
let pausedAt = 0;
let isPlaying = false;
let animationId; // anmation loop ID

const fftSize = 8192;
const hopSize = 1024;
const minFreq = 20;

const noteNames = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const allNotes = [];
for (let i = 0; i <= 9; i++) {
    noteNames.forEach((name, idx) => {
        const freq = 440 * Math.pow(2, (idx + (i + 1) * 12 - 69) / 12);
        if (freq >= minFreq) allNotes.push({ name: name + i, freq, type: name, semitoneIdx: idx });
    });
}
const fmtT = (s) => {
    const m = Math.floor(s / 60);
    const ss = Math.floor(s % 60);
    return `${m}:${ss < 10 ? "0" : ""}${ss}`;
};

fileInput.addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    audioBuf = await audioCtx.decodeAudioData(await file.arrayBuffer());
    await analyze();
    playBtn.disabled = false;
    totalTimeTxt.innerText = fmtT(audioBuf.duration);
    yOffsetRange.max = Math.floor(12 * Math.log2(audioBuf.sampleRate / 2 / minFreq));
    draw();
});

async function analyze() {
    fftData = [];
    const offCtx = new OfflineAudioContext(1, audioBuf.length, audioBuf.sampleRate);
    const src = offCtx.createBufferSource();
    const ans = offCtx.createAnalyser();
    const proc = offCtx.createScriptProcessor(hopSize, 1, 1);
    src.buffer = audioBuf;
    ans.fftSize = fftSize;
    src.connect(ans);
    ans.connect(proc);
    proc.connect(offCtx.destination);
    proc.onaudioprocess = () => {
        const data = new Uint8Array(ans.frequencyBinCount);
        ans.getByteFrequencyData(data);
        fftData.push(new Uint8Array(data));
    };
    src.start(0);
    await offCtx.startRendering();
}

function play() {
    if (isPlaying) return;
    source = audioCtx.createBufferSource();
    source.buffer = audioBuf;
    source.connect(audioCtx.destination);
    startTime = audioCtx.currentTime - pausedAt;
    source.start(0, pausedAt);
    isPlaying = true;
    playBtn.innerText = "Pause";
    animate();
}

function pause() {
    if (!isPlaying) return;
    isPlaying = false;
    if (source) {
        source.stop();
        source = null;
    }
    pausedAt = audioCtx.currentTime - startTime;
    playBtn.innerText = "Play";
    cancelAnimationFrame(animationId); // cancel recent animation loop
}

const togglePlay = () => (isPlaying ? pause() : play());
playBtn.addEventListener("click", togglePlay);

function animate() {
    if (!isPlaying) return;
    const curr = audioCtx.currentTime - startTime;
    if (curr >= audioBuf.duration) {
        isPlaying = false;
        pausedAt = 0;
        playBtn.innerText = "Play";
        offsetRange.value = 0;
        currTimeTxt.innerText = fmtT(0);
        cancelAnimationFrame(animationId);
        draw();
        return;
    }
    pausedAt = curr;
    offsetRange.value = (curr / audioBuf.duration) * 100;
    currTimeTxt.innerText = fmtT(curr);
    draw();
    animationId = requestAnimationFrame(animate); // save animation ID
}

const seekTo = (percent) => {
    if (!audioBuf) return;
    const wasPlaying = isPlaying;
    if (wasPlaying) {
        pause(); // stop current loop
    }

    pausedAt = (percent / 100) * audioBuf.duration;
    currTimeTxt.innerText = fmtT(pausedAt);
    offsetRange.value = percent;

    if (wasPlaying) {
        play(); // start new loop
    } else {
        draw();
    }
};

[scaleRange, yScaleRange, yOffsetRange, minDbInput, maxDbInput, bpmInput, gridOffsetInput, gridSelect, highlightNoteSelect].forEach((r) => r.addEventListener("input", draw));
offsetRange.addEventListener("input", () => seekTo(offsetRange.value));

window.addEventListener("keydown", (e) => {
    if (e.target.tagName === "INPUT") return;
    if (e.code === "Space") {
        e.preventDefault();
        togglePlay();
    }
    if (e.code === "ArrowLeft") {
        e.preventDefault();
        seekTo(Math.max(0, ((pausedAt - 5) / audioBuf.duration) * 100));
    }
    if (e.code === "ArrowRight") {
        e.preventDefault();
        seekTo(Math.min(100, ((pausedAt + 5) / audioBuf.duration) * 100));
    }
});

viewContainer.addEventListener(
    "wheel",
    (e) => {
        e.preventDefault();
        if (e.ctrlKey && e.shiftKey) {
            scaleRange.value = parseFloat(scaleRange.value) + (e.deltaY > 0 ? 2 : -2);
        } else if (e.ctrlKey) {
            const oldZoom = parseFloat(yScaleRange.value);
            const oldOffset = parseFloat(yOffsetRange.value);
            const centerSemi = oldOffset + oldZoom / 2;
            const newZoom = Math.max(6, Math.min(120, oldZoom + (e.deltaY > 0 ? 2 : -2)));
            yScaleRange.value = newZoom;
            yOffsetRange.value = centerSemi - newZoom / 2;
        } else if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
            const delta = e.deltaX !== 0 ? e.deltaX : e.deltaY;
            seekTo(Math.max(0, Math.min(100, parseFloat(offsetRange.value) + (delta > 0 ? 0.5 : -0.5))));
        } else {
            yOffsetRange.value = parseFloat(yOffsetRange.value) + (e.deltaY > 0 ? -1 : 1);
        }
        draw();
    },
    { passive: false },
);

function draw() {
    if (!fftData.length) return;
    const w = (canvas.width = canvas.clientWidth);
    const h = (canvas.height = canvas.clientHeight);
    const zX = parseFloat(scaleRange.value);
    const visSemi = parseFloat(yScaleRange.value);
    const sSemi = parseFloat(yOffsetRange.value);
    const mDb = parseInt(minDbInput.value) || 0;
    const xDb = parseInt(maxDbInput.value) || 255;
    const highlightTarget = highlightNoteSelect.value;
    const centerIdx = Math.floor(fftData.length * (pausedAt / audioBuf.duration));
    const visHalfX = Math.floor(fftData.length / zX / 2);
    const binFreq = audioBuf.sampleRate / fftSize;
    const rowH = h / visSemi;
    const subRowH = rowH / 3;
    const colW = w / (visHalfX * 2);

    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, w, h);

    allNotes.forEach((note) => {
        const nSemi = 12 * Math.log2(note.freq / minFreq);
        const cY = h - ((nSemi - sSemi) / visSemi) * h;
        if (cY + rowH > 0 && cY - rowH < h) {
            ctx.fillStyle = note.type === highlightTarget ? "rgba(255, 255, 255, 0.12)" : note.type.includes("#") ? "rgba(255, 255, 255, 0.02)" : "rgba(255, 255, 255, 0.05)";
            ctx.fillRect(0, cY - rowH / 2, w, rowH);
            for (let k = 0; k < 3; k++) {
                const subFreq = note.freq * Math.pow(2, (k - 1) / 3 / 12);
                const sB = Math.floor((subFreq * Math.pow(2, -0.5 / 36)) / binFreq);
                const eB = Math.ceil((subFreq * Math.pow(2, 0.5 / 36)) / binFreq);
                const subY = cY + (1 - k) * subRowH - subRowH / 2;
                for (let i = -visHalfX; i < visHalfX; i++) {
                    const dIdx = centerIdx + i;
                    if (dIdx < 0 || dIdx >= fftData.length) continue;
                    let maxV = 0;
                    for (let b = sB; b <= eB; b++) if (fftData[dIdx][b] > maxV) maxV = fftData[dIdx][b];
                    if (maxV > mDb) {
                        const r = Math.min(1, (maxV - mDb) / (xDb - mDb));
                        ctx.fillStyle = `hsl(${240 - r * 240}, 80%, 50%, ${r})`;
                        ctx.fillRect((i + visHalfX) * colW, subY, colW + 0.8, subRowH + 0.3);
                    }
                }
            }
            ctx.strokeStyle = "rgba(255, 255, 255, 0.05)";
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(0, cY + rowH / 2);
            ctx.lineTo(w, cY + rowH / 2);
            ctx.stroke();
            if (note.type === highlightTarget || (visSemi <= 73 && note.type === "G") || visSemi <= 49) {
                ctx.fillStyle = note.type === highlightTarget ? "#00ff00" : "#777";
                ctx.font = note.type === highlightTarget ? "bold 10px monospace" : "9px monospace";
                ctx.fillText(note.name, 5, cY + 3);
            }
        }
    });

    const bpm = parseFloat(bpmInput.value) || 120;
    const barDur = 240 / bpm;
    const div = parseInt(gridSelect.value);
    const gridDur = barDur / div;
    const gOff = (parseInt(gridOffsetInput.value) / 96) * barDur;
    const timePerPx = (visHalfX * 2 * (hopSize / audioBuf.sampleRate)) / w;
    const startT = pausedAt - (w / 2) * timePerPx;
    const endT = pausedAt + (w / 2) * timePerPx;
    let gIdx = Math.ceil((startT - gOff) / gridDur);
    let t = gOff + gIdx * gridDur;
    while (t <= endT) {
        if (t >= 0 && t <= audioBuf.duration) {
            const x = (t - startT) / timePerPx;
            const isB = ((gIdx % div) + div) % div === 0;
            ctx.strokeStyle = isB ? "rgba(255, 255, 0, 0.6)" : "rgba(255, 255, 255, 0.1)";
            ctx.lineWidth = isB ? 2 : 1;
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, h);
            ctx.stroke();
            if (isB) {
                ctx.fillStyle = "rgba(255, 255, 0, 0.4)";
                ctx.fillText(Math.floor(gIdx / div) + 1, x + 4, h - 10);
            }
        }
        gIdx++;
        t = gOff + gIdx * gridDur;
    }
}
