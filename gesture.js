/* ==========================================================
   Hand writing with the camera
   - MediaPipe HandLandmarker finds 21 points on your hand
   - Point with ONLY your index finger  -> the fingertip "draws"
   - Make a fist / open hand            -> stroke ends, digit is recognized
   - MediaPipe FaceDetector just checks that a face is in view
     (it does NOT identify who you are)
   Needs: http://localhost (VS Code Live Server) + internet for the models
   ========================================================== */

import { FilesetResolver, HandLandmarker, FaceDetector }
  from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs";
import { recognizeDigit } from "./digit-recognizer.js";


/* ==========================================================
   1. Settings and page elements
   ========================================================== */
const WASM_URL   = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";
const HAND_MODEL = "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";
const FACE_MODEL = "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite";

const CONFIG = {
  startFrames: 3,        // frames of pointing before a stroke starts
  endFrames: 6,          // frames of NOT pointing before a stroke ends
  smoothing: 0.5,        // 0..1, lower = smoother but laggier line
  minPointGap: 3,        // ignore finger moves smaller than this (pixels)
  minStrokePoints: 12,   // fewer points than this = accidental
  minStrokeSize: 0.12,   // digit must be at least 12% of the video height
  trimPoints: 2,         // cut shaky points at the start and end of a stroke
  faceEveryNFrames: 10   // face check is cheap but does not need every frame
};

const camBtn     = document.getElementById("camBtn");
const camView    = document.getElementById("camView");
const video      = document.getElementById("video");
const overlay    = document.getElementById("overlay");
const camStatus  = document.getElementById("camStatus");
const faceChip   = document.getElementById("faceChip");
const digitBadge = document.getElementById("digitBadge");
const ctx = overlay.getContext("2d");


/* ==========================================================
   2. State
   ========================================================== */
let handLandmarker = null;
let faceDetector = null;
let stream = null;
let running = false;
let animationId = 0;
let lastVideoTime = -1;
let frameCount = 0;

let drawing = false;
let pointFrames = 0;
let idleFrames = 0;
let currentStroke = [];   // points of the digit being written
let fadingStroke = [];    // finished stroke, shown briefly
let fadeTimer = 0;
let badgeTimer = 0;


/* ==========================================================
   3. Small UI helpers
   ========================================================== */
function setStatus(text, isError = false) {
  camStatus.textContent = text;
  camStatus.classList.toggle("is-error", isError);
}

function showBadge(text, ok) {
  digitBadge.textContent = text;
  digitBadge.dataset.ok = String(ok);
  digitBadge.classList.add("show");
  clearTimeout(badgeTimer);
  badgeTimer = setTimeout(() => digitBadge.classList.remove("show"), 1200);
}

function setFaceChip(found) {
  faceChip.hidden = false;
  faceChip.dataset.on = String(found);
  faceChip.textContent = found ? "Face detected" : "No face in view";
}


/* ==========================================================
   4. Load the AI models (once)
   ========================================================== */
// Try the graphics card first, fall back to the processor
async function createWithFallback(create) {
  try {
    return await create("GPU");
  } catch (error) {
    return await create("CPU");
  }
}

async function loadModels() {
  if (handLandmarker) return;

  const vision = await FilesetResolver.forVisionTasks(WASM_URL);

  handLandmarker = await createWithFallback((delegate) =>
    HandLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: HAND_MODEL, delegate },
      runningMode: "VIDEO",
      numHands: 1
    })
  );

  // Face check is optional: if it fails, hand writing still works
  try {
    faceDetector = await createWithFallback((delegate) =>
      FaceDetector.createFromOptions(vision, {
        baseOptions: { modelAssetPath: FACE_MODEL, delegate },
        runningMode: "VIDEO"
      })
    );
  } catch (error) {
    faceDetector = null;
  }
}


/* ==========================================================
   5. Hand pose: is only the index finger pointing?
   ========================================================== */
function isPointing(landmarks) {
  const W = video.videoWidth;
  const H = video.videoHeight;
  const wrist = landmarks[0];
  const distanceToWrist = (p) => Math.hypot((p.x - wrist.x) * W, (p.y - wrist.y) * H);

  // A finger is "extended" when its tip is farther from the wrist than its middle joint
  const extended = (tip, joint) =>
    distanceToWrist(landmarks[tip]) > distanceToWrist(landmarks[joint]) * 1.05;

  return extended(8, 6) &&      // index up
         !extended(12, 10) &&   // middle curled
         !extended(16, 14) &&   // ring curled
         !extended(20, 18);     // pinky curled
}


/* ==========================================================
   6. Writing a stroke
   ========================================================== */
function addPoint(fingertip) {
  // Mirror x so writing looks natural (like the mirrored video)
  const raw = {
    x: (1 - fingertip.x) * video.videoWidth,
    y: fingertip.y * video.videoHeight
  };

  const last = currentStroke[currentStroke.length - 1];
  if (!last) { currentStroke.push(raw); return; }

  // Smooth the shaky fingertip a little
  const point = {
    x: last.x + CONFIG.smoothing * (raw.x - last.x),
    y: last.y + CONFIG.smoothing * (raw.y - last.y)
  };
  if (Math.hypot(point.x - last.x, point.y - last.y) >= CONFIG.minPointGap) {
    currentStroke.push(point);
  }
}

function strokeSize(points) {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  return Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
}

function startStroke() {
  drawing = true;
  currentStroke = [];
  fadingStroke = [];
  setStatus("Writing… make a fist or open your hand when done.");
}

function endStroke() {
  drawing = false;

  // Keep the line on screen for a moment
  fadingStroke = currentStroke.slice();
  clearTimeout(fadeTimer);
  fadeTimer = setTimeout(() => { fadingStroke = []; }, 700);

  let points = currentStroke;
  currentStroke = [];

  if (points.length > 2 * CONFIG.trimPoints + CONFIG.minStrokePoints) {
    points = points.slice(CONFIG.trimPoints, -CONFIG.trimPoints);
  }

  const relativeSize = points.length ? strokeSize(points) / video.videoHeight : 0;
  if (points.length < CONFIG.minStrokePoints || relativeSize < CONFIG.minStrokeSize) {
    setStatus("That was too small. Write the digit bigger.");
    showBadge("…", false);
    return;
  }

  const result = recognizeDigit(points);

  if (!result.accepted) {
    setStatus(`I'm not sure what that was (closest: ${result.digit}). Try again, a little slower.`);
    showBadge("?", false);
    return;
  }

  window.calculator.writeDigit(result.digit);   // type it into the calculator
  setStatus(`Wrote ${result.digit}. Write the next digit, or use the keypad.`);
  showBadge(result.digit, true);
}

// Called for every camera frame
function processHand(landmarks) {
  const pointing = landmarks !== null && isPointing(landmarks);

  if (pointing) { pointFrames++; idleFrames = 0; }
  else          { idleFrames++;  pointFrames = 0; }

  if (!drawing && pointFrames >= CONFIG.startFrames) startStroke();

  if (drawing) {
    if (pointing) addPoint(landmarks[8]);               // landmark 8 = index fingertip
    else if (idleFrames >= CONFIG.endFrames) endStroke();
  }
  return pointing;
}


/* ==========================================================
   7. Drawing on the camera overlay
   ========================================================== */
function drawOverlay(landmarks, pointing) {
  const W = overlay.width;
  const H = overlay.height;
  ctx.clearRect(0, 0, W, H);

  // The line you are writing
  const trail = drawing ? currentStroke : fadingStroke;
  if (trail.length > 1) {
    ctx.lineWidth = 7;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#38bdf8";
    ctx.beginPath();
    trail.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.stroke();
  }

  // Hand points (the index fingertip turns green while pointing)
  if (landmarks) {
    landmarks.forEach((point, index) => {
      ctx.beginPath();
      ctx.arc((1 - point.x) * W, point.y * H, index === 8 ? 9 : 3, 0, Math.PI * 2);
      ctx.fillStyle = index === 8 ? (pointing ? "#22c55e" : "#9ca3af") : "rgba(255,255,255,0.6)";
      ctx.fill();
    });
  }
}


/* ==========================================================
   8. Camera loop
   ========================================================== */
function loop() {
  if (!running) return;

  if (video.readyState >= 2 && video.currentTime !== lastVideoTime) {
    lastVideoTime = video.currentTime;
    const now = performance.now();
    frameCount++;

    const result = handLandmarker.detectForVideo(video, now);
    const landmarks = result.landmarks[0] ?? null;

    if (faceDetector && frameCount % CONFIG.faceEveryNFrames === 0) {
      setFaceChip(faceDetector.detectForVideo(video, now).detections.length > 0);
    }

    const pointing = processHand(landmarks);
    drawOverlay(landmarks, pointing);
  }
  animationId = requestAnimationFrame(loop);
}


/* ==========================================================
   9. Turn the camera on / off
   ========================================================== */
const CAMERA_ERRORS = {
  NotAllowedError: "Camera is blocked. Allow it in the address bar, or use the keypad.",
  NotFoundError: "No camera found. Use the keypad or voice instead.",
  NotReadableError: "The camera is being used by another app. Close it and try again."
};

async function startCamera() {
  camBtn.disabled = true;
  setStatus("Loading hand tracking… (first time takes a few seconds)");

  try {
    await loadModels();
  } catch (error) {
    setStatus("Couldn't load hand tracking. Check your internet connection.", true);
    camBtn.disabled = false;
    return;
  }

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
      audio: false
    });
    video.srcObject = stream;
    await video.play();
  } catch (error) {
    setStatus(CAMERA_ERRORS[error.name] || "Couldn't start the camera.", true);
    camBtn.disabled = false;
    return;
  }

  // Match the overlay to the real camera size
  overlay.width = video.videoWidth;
  overlay.height = video.videoHeight;
  camView.style.aspectRatio = `${video.videoWidth} / ${video.videoHeight}`;
  camView.hidden = false;

  camBtn.disabled = false;
  camBtn.classList.add("is-on");
  camBtn.querySelector("span").textContent = "Turn camera off";

  running = true;
  lastVideoTime = -1;
  frameCount = 0;
  setStatus("Point with ONLY your index finger and write a digit in the air.");
  loop();
}

function stopCamera() {
  running = false;
  cancelAnimationFrame(animationId);
  stream?.getTracks().forEach((track) => track.stop());
  stream = null;
  video.srcObject = null;

  drawing = false;
  currentStroke = [];
  fadingStroke = [];
  pointFrames = 0;
  idleFrames = 0;

  camView.hidden = true;
  faceChip.hidden = true;
  camBtn.classList.remove("is-on");
  camBtn.querySelector("span").textContent = "Write with your hand";
  setStatus("Camera is off.");
}

camBtn.addEventListener("click", () => (running ? stopCamera() : startCamera()));
