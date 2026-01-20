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
const currTimeTxt = document.getElementById("currTime");
const totalTimeTxt = document.getElementById("totalTime");
const viewContainer = document.getElementById("viewContainer");
const diffTimeToggle = document.getElementById("diffTimeToggle");
const diffFreqToggle = document.getElementById("diffFreqToggle");

const lCnv = document.getElementById("laneCanvas");
const lCtx = lCnv.getContext("2d");
const dCnv = document.getElementById("dataCanvas");
const dCtx = dCnv.getContext("2d");
const gCnv = document.getElementById("gridCanvas");
const gCtx = gCnv.getContext("2d");

let audioCtx;
let audioBuf;
let source;
let fftData = [];
let startTime = 0;
let pausedAt = 0;
let isPlaying = false;
let animationId;
let intensityData = [];
let diffTimeData = [];
let diffFreqData = [];
let colorCache = new Array(256);

const fftSize = 8192;
const hopSize = 256;
const minFreq = 20;
const noteNames = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const allNotes = [];

for (let i = 0; i <= 9; i++) {
    noteNames.forEach((name, idx) => {
        const freq = 440 * Math.pow(2, (idx + (i + 1) * 12 - 69) / 12);
        if (freq >= minFreq) {
            allNotes.push({
                name: name + i,
                freq: freq,
                type: name,
                semi: 12 * Math.log2(freq / minFreq),
            });
        }
    });
}

let lastLaneState = "";
let lastGridState = "";

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
    const sr = audioBuf.sampleRate;
    const offCtx = new OfflineAudioContext(1, audioBuf.length, sr);
    const src = offCtx.createBufferSource();
    src.buffer = audioBuf;
    const ans = offCtx.createAnalyser();
    ans.fftSize = fftSize;
    src.connect(ans);
    ans.connect(offCtx.destination);

    for (let i = 0; i < audioBuf.length; i += hopSize) {
        const time = i / sr;
        offCtx.suspend(time).then(() => {
            const data = new Uint8Array(ans.frequencyBinCount);
            ans.getByteFrequencyData(data);
            fftData.push(data);
            offCtx.resume();
        });
    }
    src.start(0);
    await offCtx.startRendering();
    computeIntensityData();
}

function computeIntensityData() {
    intensityData = [];
    const binFreq = audioBuf.sampleRate / fftSize;
    const binRanges = allNotes.map((note) =>
        [0, 1, 2].map((k) => {
            const f = note.freq * Math.pow(2, (k - 1) / 3 / 12);
            return {
                sB: Math.floor((f * Math.pow(2, -0.5 / 36)) / binFreq),
                eB: Math.ceil((f * Math.pow(2, 0.5 / 36)) / binFreq),
            };
        }),
    );

    // fft
    for (let i = 0; i < fftData.length; i++) {
        const frame = fftData[i];
        const intensities = new Uint8Array(allNotes.length * 3);
        for (let n = 0; n < allNotes.length; n++) {
            for (let k = 0; k < 3; k++) {
                const r = binRanges[n][k];
                let maxV = 0;
                for (let b = r.sB; b <= r.eB; b++) {
                    if (frame[b] > maxV) maxV = frame[b];
                }
                intensities[n * 3 + k] = maxV;
            }
        }
        intensityData.push(intensities);
    }

    // diffrentiation
    for (let i = 0; i < intensityData.length; i++) {
        const currFrame = intensityData[i];
        const prevFrame = intensityData[i - 1] || currFrame;
        const dT = new Uint8Array(currFrame.length);
        const dF = new Uint8Array(currFrame.length);

        for (let j = 0; j < currFrame.length; j++) {
            // df/dt
            const diffT = Math.abs(currFrame[j] - prevFrame[j]);
            dT[j] = diffT;

            // df/dw
            const nextVal = currFrame[j + 1] || currFrame[j];
            const diffF = Math.abs(currFrame[j] - nextVal);
            dF[j] = diffF;
        }
        diffTimeData.push(dT);
        diffFreqData.push(dF);
    }
}

function updateColorCache() {
    const mDb = parseInt(minDbInput.value) || 0;
    const xDb = parseInt(maxDbInput.value) || 255;
    for (let i = 0; i < 256; i++) {
        if (i <= mDb) {
            colorCache[i] = null;
        } else {
            const r = Math.min(1, (i - mDb) / Math.max(1, xDb - mDb));
            colorCache[i] = `hsl(${240 - r * 240}, 80%, 50%, ${r})`;
        }
    }
}

function drawLanes(w, h, visSemi, sSemi, highlightTarget) {
    const state = `${visSemi}-${sSemi}-${highlightTarget}-${w}-${h}`;
    if (state === lastLaneState) return;
    lastLaneState = state;
    lCnv.width = w;
    lCnv.height = h;
    lCtx.clearRect(0, 0, w, h);
    const rowH = h / visSemi;
    allNotes.forEach((note) => {
        const cY = h - ((note.semi - sSemi) / visSemi) * h;
        if (cY + rowH > 0 && cY - rowH < h) {
            lCtx.fillStyle = note.type === highlightTarget ? "rgba(255, 255, 255, 0.12)" : note.type.includes("#") ? "rgba(255, 255, 255, 0.02)" : "rgba(255, 255, 255, 0.05)";
            lCtx.fillRect(0, cY - rowH / 2, w, rowH);
            lCtx.strokeStyle = "rgba(255, 255, 255, 0.05)";
            lCtx.lineWidth = 1;
            lCtx.beginPath();
            lCtx.moveTo(0, cY + rowH / 2);
            lCtx.lineTo(w, cY + rowH / 2);
            lCtx.stroke();
            if (note.type === highlightTarget || (visSemi <= 73 && note.type === "G") || visSemi <= 49) {
                lCtx.fillStyle = note.type === highlightTarget ? "#00ff00" : "#777";
                lCtx.font = note.type === highlightTarget ? "bold 10px monospace" : "9px monospace";
                lCtx.fillText(note.name, 5, cY + 3);
            }
        }
    });
}

function drawData(w, h, visSemi, sSemi, zX) {
    dCnv.width = w;
    dCnv.height = h;
    updateColorCache();
    const centerIdx = Math.floor(intensityData.length * (pausedAt / audioBuf.duration));
    const visHalfX = Math.floor(intensityData.length / zX / 2);
    const colW = w / (visHalfX * 2);
    const rowH = h / visSemi;
    const subRowH = rowH / 3;

    const useDiffT = diffTimeToggle.checked;
    const useDiffF = diffFreqToggle.checked;

    const visibleIndices = [];
    for (let n = 0; n < allNotes.length; n++) {
        const cY = h - ((allNotes[n].semi - sSemi) / visSemi) * h;
        if (cY + rowH > 0 && cY - rowH < h) {
            visibleIndices.push({ n, cY });
        }
    }

    visibleIndices.forEach(({ n, cY }) => {
        for (let k = 0; k < 3; k++) {
            const subY = cY + (1 - k) * subRowH - subRowH / 2;
            const dataOffset = n * 3 + k;

            for (let i = -visHalfX; i < visHalfX; i++) {
                const dIdx = centerIdx + i;
                if (dIdx < 0 || dIdx >= intensityData.length) continue;
                let val = intensityData[dIdx][n * 3 + k];

                if (useDiffT) val += diffTimeData[dIdx][dataOffset] * 1.5;
                if (useDiffF) val += diffFreqData[dIdx][dataOffset] * 1.5;

                const color = colorCache[val];
                if (color) {
                    dCtx.fillStyle = color;
                    dCtx.fillRect((i + visHalfX) * colW, subY, colW + 0.8, subRowH + 0.3);
                }
            }
        }
    });
}

function drawGrid(w, h, startT, endT, timePerPx, barDur, div, gridDur, gOff) {
    const state = `${w}-${h}-${startT}-${endT}-${barDur}-${div}-${gOff}`;
    if (state === lastGridState) return;
    lastGridState = state;
    gCnv.width = w;
    gCnv.height = h;
    let gIdx = Math.ceil((startT - gOff) / gridDur);
    let t = gOff + gIdx * gridDur;
    while (t <= endT) {
        if (t >= 0 && t <= audioBuf.duration) {
            const x = (t - startT) / timePerPx;
            const isB = ((gIdx % div) + div) % div === 0;
            gCtx.strokeStyle = isB ? "rgba(255, 255, 0, 0.6)" : "rgba(255, 255, 255, 0.1)";
            gCtx.lineWidth = isB ? 2 : 1;
            gCtx.beginPath();
            gCtx.moveTo(x, 0);
            gCtx.lineTo(x, h);
            gCtx.stroke();
            if (isB) {
                gCtx.fillStyle = "rgba(255, 255, 0, 0.4)";
                gCtx.fillText(Math.floor(gIdx / div) + 1, x + 4, h - 10);
            }
        }
        gIdx++;
        t = gOff + gIdx * gridDur;
    }
}

function draw() {
    if (!intensityData.length) return;
    const w = viewContainer.clientWidth;
    const h = viewContainer.clientHeight;
    const zX = parseFloat(scaleRange.value);
    const visSemi = parseFloat(yScaleRange.value);
    const sSemi = parseFloat(yOffsetRange.value);

    drawLanes(w, h, visSemi, sSemi, highlightNoteSelect.value);
    drawData(w, h, visSemi, sSemi, zX);

    const bpm = parseFloat(bpmInput.value) || 120;
    const barDur = 240 / bpm;
    const div = parseInt(gridSelect.value);
    const gridDur = barDur / div;
    const gOff = (parseInt(gridOffsetInput.value) / 96) * barDur;
    const visHalfX = Math.floor(intensityData.length / zX / 2);
    const timePerPx = (visHalfX * 2 * (hopSize / audioBuf.sampleRate)) / w;

    drawGrid(w, h, pausedAt - (w / 2) * timePerPx, pausedAt + (w / 2) * timePerPx, timePerPx, barDur, div, gridDur, gOff);
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
    cancelAnimationFrame(animationId);
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
    animationId = requestAnimationFrame(animate);
}

const seekTo = (percent) => {
    if (!audioBuf) return;
    const wasPlaying = isPlaying;
    if (wasPlaying) pause();
    pausedAt = (percent / 100) * audioBuf.duration;
    currTimeTxt.innerText = fmtT(pausedAt);
    offsetRange.value = percent;
    if (wasPlaying) play();
    else draw();
};

[scaleRange, yScaleRange, yOffsetRange, minDbInput, maxDbInput, bpmInput, gridOffsetInput, gridSelect, highlightNoteSelect, diffTimeToggle, diffFreqToggle].forEach((r) => r.addEventListener("input", draw));
[scaleRange, yScaleRange, yOffsetRange, offsetRange, diffTimeToggle, diffFreqToggle].forEach((r) => r.addEventListener("change", () => r.blur()));
offsetRange.addEventListener("input", () => seekTo(offsetRange.value));

let SpacePressed = false;
let ArrowLeftPressed = false;
let ArrowRightPressed = false;

window.addEventListener("keydown", (e) => {
    if (e.target.tagName === "INPUT") return;
    if (e.code === "Space") {
        if (SpacePressed) return;
        SpacePressed = true;
        e.preventDefault();
        togglePlay();
    }
    if (e.code === "ArrowLeft") {
        if (ArrowLeftPressed) return;
        ArrowLeftPressed = true;
        e.preventDefault();
        seekTo(Math.max(0, ((pausedAt - 5) / audioBuf.duration) * 100));
    }
    if (e.code === "ArrowRight") {
        if (ArrowRightPressed) return;
        ArrowRightPressed = true;
        e.preventDefault();
        seekTo(Math.min(100, ((pausedAt + 5) / audioBuf.duration) * 100));
    }
});

window.addEventListener("keyup", (e) => {
    if (e.code === "Space") {
        SpacePressed = false;
    }
    if (e.code === "ArrowLeft") {
        ArrowLeftPressed = false;
    }
    if (e.code === "ArrowRight") {
        ArrowRightPressed = false;
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
