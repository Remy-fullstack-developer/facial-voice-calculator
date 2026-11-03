/* ==========================================================
   Digit recognizer
   Input : a stroke = list of points [{x, y}, ...] drawn in the air
   Output: the digit it most looks like (0-9) + how sure we are

   How it works (simple "template matching"):
     1. Resample the stroke to 64 evenly spaced points
     2. Scale it to a standard size and centre it
     3. Compare it with built-in template strokes for every digit
     4. The closest template wins
   The direction you draw in matters (that is how 6 and 9 differ),
   so several templates exist per digit for common writing styles.
   ========================================================== */

const SAMPLE_COUNT = 64;
const ASPECT_CAP = 0.45;    // strokes wider than 45% of their height all count as "wide"
const ASPECT_WEIGHT = 0.8;  // how much thin-vs-wide matters
const END_WEIGHT = 0.15;    // how much start/end position matters

// Tune these two numbers if it rejects good digits or accepts bad ones
export const SETTINGS = {
  maxDistance: 0.30, // bigger = more forgiving
  minMargin: 0.02    // how much better the winner must be than the runner-up
};


/* ---------- 1. Helpers to describe template strokes ---------- */

// Points on an ellipse arc. Angles in degrees: 0 = right, 90 = down, -90 = up
function arc(cx, cy, rx, ry, fromDeg, toDeg, steps = 24) {
  const points = [];
  for (let i = 0; i <= steps; i++) {
    const angle = ((fromDeg + (toDeg - fromDeg) * (i / steps)) * Math.PI) / 180;
    points.push({ x: cx + rx * Math.cos(angle), y: cy + ry * Math.sin(angle) });
  }
  return points;
}

// Straight segments through the given corner points
const line = (...corners) => corners.map(([x, y]) => ({ x, y }));

// Glue several pieces into one continuous stroke
const join = (...pieces) => pieces.flat();

// Flip left <-> right
const mirror = (points) => points.map((p) => ({ x: 1 - p.x, y: p.y }));


/* ---------- 2. Template strokes (drawn inside a 0..1 box, y goes down) ---------- */
export const DIGIT_TEMPLATES = {
  0: [
    arc(0.5, 0.5, 0.4, 0.5, -90, -450),   // counter-clockwise from the top
    arc(0.5, 0.5, 0.4, 0.5, -90, 270),    // clockwise from the top
    arc(0.5, 0.5, 0.4, 0.5, -135, -495),
    arc(0.5, 0.5, 0.4, 0.5, -45, 315)
  ],
  1: [
    line([0.3, 0.28], [0.55, 0], [0.55, 1]),
    line([0.5, 0], [0.5, 1]),
    line([0.4, 0.1], [0.6, 0], [0.6, 1])
  ],
  2: [
    join(arc(0.5, 0.27, 0.42, 0.27, -180, 30), line([0.05, 1], [1, 1])),
    join(arc(0.5, 0.27, 0.42, 0.27, -200, 20), line([0.05, 1], [1, 1]))
  ],
  3: [
    join(arc(0.45, 0.25, 0.4, 0.25, -150, 90), arc(0.45, 0.75, 0.5, 0.25, -90, 150)),
    join(line([0, 0], [1, 0], [0.45, 0.45]), arc(0.45, 0.73, 0.5, 0.27, -90, 150))
  ],
  4: [
    line([0.7, 0], [0, 0.65], [1, 0.65]),
    line([0.75, 1], [0.75, 0], [0, 0.65], [1, 0.65]),
    line([0.1, 0], [0.1, 0.55], [0.9, 0.55])
  ],
  5: [
    join(line([0.95, 0], [0.15, 0], [0.1, 0.45]), arc(0.5, 0.68, 0.42, 0.32, -120, 150)),
    join(line([0.9, 0], [0.2, 0.02], [0.12, 0.45]), arc(0.5, 0.68, 0.42, 0.32, -150, 160))
  ],
  6: [
    join(line([0.85, 0.02], [0.45, 0.12], [0.15, 0.45], [0.1, 0.62]), arc(0.5, 0.68, 0.4, 0.32, 180, -180)),
    join(line([0.7, 0], [0.2, 0.4], [0.08, 0.7]), arc(0.5, 0.68, 0.4, 0.32, 180, -180))
  ],
  7: [
    line([0, 0.02], [1, 0], [0.35, 1]),
    line([0.05, 0], [0.95, 0], [0.5, 0.5], [0.35, 1])
  ],
  8: [
    join(arc(0.5, 0.25, 0.3, 0.25, -45, -270), arc(0.5, 0.75, 0.4, 0.25, -90, 270)),
    mirror(join(arc(0.5, 0.25, 0.3, 0.25, -45, -270), arc(0.5, 0.75, 0.4, 0.25, -90, 270)))
  ],
  9: [
    join(arc(0.5, 0.3, 0.38, 0.3, 0, -360), line([0.88, 0.3], [0.8, 0.65], [0.6, 1])),
    join(arc(0.5, 0.3, 0.38, 0.3, 0, 360), line([0.88, 0.3], [0.8, 0.65], [0.6, 1])),
    join(arc(0.5, 0.3, 0.38, 0.3, -90, -360), line([0.88, 0.3], [0.8, 0.65], [0.6, 1]))
  ]
};


/* ---------- 3. Geometry ---------- */
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

function pathLength(points) {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += distance(points[i - 1], points[i]);
  return total;
}

// Evenly spaced copy of the stroke with exactly `count` points
function resample(points, count) {
  const total = pathLength(points);
  if (total === 0) return Array.from({ length: count }, () => ({ ...points[0] }));

  const step = total / (count - 1);
  const result = [{ ...points[0] }];
  let previous = points[0];
  let covered = 0;

  for (let i = 1; i < points.length; i++) {
    const current = points[i];
    let gap = distance(previous, current);

    while (covered + gap >= step && gap > 0) {
      const t = (step - covered) / gap;
      const point = {
        x: previous.x + t * (current.x - previous.x),
        y: previous.y + t * (current.y - previous.y)
      };
      result.push(point);
      previous = point;
      gap = distance(previous, current);
      covered = 0;
    }
    covered += gap;
    previous = current;
  }

  while (result.length < count) result.push({ ...points[points.length - 1] });
  return result.slice(0, count);
}

// Same size + position for every stroke, so only the SHAPE is compared
function normalize(points) {
  const pts = resample(points, SAMPLE_COUNT);

  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const width = Math.max(...xs) - minX;
  const rawHeight = Math.max(...ys) - minY;

  // Keep a thin "1" thin, but stretch everything else to a square
  const height = Math.max(rawHeight, 0.35 * width, 1e-6);
  const scaleX = 1 / Math.max(width, 0.35 * height);
  const scaleY = 1 / height;

  const scaled = pts.map((p) => ({ x: (p.x - minX) * scaleX, y: (p.y - minY) * scaleY }));

  const centerX = scaled.reduce((sum, p) => sum + p.x, 0) / scaled.length;
  const centerY = scaled.reduce((sum, p) => sum + p.y, 0) / scaled.length;

  return {
    points: scaled.map((p) => ({ x: p.x - centerX, y: p.y - centerY })),
    // How wide the digit is compared with its height. Only matters for thin
    // digits (a "1"), so everything wider than ASPECT_CAP counts the same.
    aspect: Math.min(width / Math.max(rawHeight, 1e-6), ASPECT_CAP)
  };
}

// How different two normalized strokes are (0 = identical)
function strokeDistance(candidate, template) {
  const a = candidate.points;
  const b = template.points;

  // 1) Average distance between matching points along the stroke
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += distance(a[i], b[i]);
  const shape = sum / a.length;

  // 2) Extra penalty if the start or end is in the wrong place
  //    (a "2" ends bottom-right, a "7" does not)
  const ends = (distance(a[0], b[0]) + distance(a[a.length - 1], b[b.length - 1])) * END_WEIGHT;

  // 3) Extra penalty if a thin stroke is compared with a wide template (1 vs 7)
  const thinness = Math.abs(candidate.aspect - template.aspect) * ASPECT_WEIGHT;

  return shape + ends + thinness;
}


/* ---------- 4. Prepare templates once ---------- */
const TEMPLATES = Object.entries(DIGIT_TEMPLATES).flatMap(([digit, strokes]) =>
  strokes.map((stroke) => ({ digit, ...normalize(stroke) }))
);


/* ---------- 5. Public function ---------- */
export function recognizeDigit(points) {
  const candidate = normalize(points);

  // Best (smallest) distance for each digit
  const best = {};
  for (const template of TEMPLATES) {
    const d = strokeDistance(candidate, template);
    if (best[template.digit] === undefined || d < best[template.digit]) {
      best[template.digit] = d;
    }
  }

  const ranked = Object.entries(best).sort((a, b) => a[1] - b[1]);
  const [digit, bestDistance] = ranked[0];
  const margin = ranked[1][1] - bestDistance;

  return {
    digit,
    distance: bestDistance,
    margin,
    confidence: Math.max(0, Math.min(1, 1 - bestDistance / 0.5)),
    accepted: bestDistance <= SETTINGS.maxDistance && margin >= SETTINGS.minMargin
  };
}
