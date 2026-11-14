// The sky around the globe, true to the scene's date: Cesium already draws the star field (Tycho-2),
// the Sun and the Moon at their real positions; this adds the planets Mercury to Neptune as star-like
// points at their real directions, sized by apparent brightness, with their name shown on hover.
//
// Positions: Keplerian elements and rates from JPL "Approximate Positions of the Planets", Table 1
// (valid 1800–2050, ≲ 1′ error for the inner planets: far below one pixel at any zoom here).
// https://ssd.jpl.nasa.gov/planets/approx_pos.html

import type {
  BillboardCollection,
  Cartesian2,
  Cartesian3,
  JulianDate,
  LabelCollection,
  Quaternion,
  Viewer,
} from "cesium";

import type { CesiumModule } from "./load";

type Elements = [a: number, e: number, i: number, L: number, peri: number, node: number];

interface Planet {
  name: string;
  j2000: Elements;
  perCentury: Elements;
  /** Sprite size in px: a stand-in for apparent brightness (Venus brightest, Neptune barely visible). */
  size: number;
  tint: string;
}

const EARTH_MOON_BARYCENTRE: Pick<Planet, "j2000" | "perCentury"> = {
  j2000: [1.00000261, 0.01671123, -0.00001531, 100.46457166, 102.93768193, 0],
  perCentury: [0.00000562, -0.00004392, -0.01294668, 35999.37244981, 0.32327364, 0],
};

const PLANETS: Planet[] = [
  {
    name: "Mercury",
    j2000: [0.38709927, 0.20563593, 7.00497902, 252.2503235, 77.45779628, 48.33076593],
    perCentury: [0.00000037, 0.00001906, -0.00594749, 149472.67411175, 0.16047689, -0.12534081],
    size: 5,
    tint: "#e8e2d6",
  },
  {
    name: "Venus",
    j2000: [0.72333566, 0.00677672, 3.39467605, 181.9790995, 131.60246718, 76.67984255],
    perCentury: [0.0000039, -0.00004107, -0.0007889, 58517.81538729, 0.00268329, -0.27769418],
    size: 10,
    tint: "#fffbea",
  },
  {
    name: "Mars",
    j2000: [1.52371034, 0.0933941, 1.84969142, -4.55343205, -23.94362959, 49.55953891],
    perCentury: [0.00001847, 0.00007882, -0.00813131, 19140.30268499, 0.44441088, -0.29257343],
    size: 6.5,
    tint: "#ffb38a",
  },
  {
    name: "Jupiter",
    j2000: [5.202887, 0.04838624, 1.30439695, 34.39644051, 14.72847983, 100.47390909],
    perCentury: [-0.00011607, -0.00013253, -0.00183714, 3034.74612775, 0.21252668, 0.20469106],
    size: 8.5,
    tint: "#fff2dc",
  },
  {
    name: "Saturn",
    j2000: [9.53667594, 0.05386179, 2.48599187, 49.95424423, 92.59887831, 113.66242448],
    perCentury: [-0.0012506, -0.00050991, 0.00193609, 1222.49362201, -0.41897216, -0.28867794],
    size: 6.5,
    tint: "#f6e3b4",
  },
  {
    name: "Uranus",
    j2000: [19.18916464, 0.04725744, 0.77263783, 313.23810451, 170.9542763, 74.01692503],
    perCentury: [-0.00196176, -0.00004397, -0.00242939, 428.48202785, 0.40805281, 0.04240589],
    size: 3.5,
    tint: "#c9f1f5",
  },
  {
    name: "Neptune",
    j2000: [30.06992276, 0.00859048, 1.77004347, -55.12002969, 44.96476227, 131.78422574],
    perCentury: [0.00026291, 0.00005105, 0.00035372, 218.45945325, -0.32241464, -0.00508664],
    size: 3,
    tint: "#b9cdfa",
  },
];

const D2R = Math.PI / 180;
const OBLIQUITY = 23.43928 * D2R;

/** Heliocentric position in the J2000 ecliptic frame, astronomical units. */
function heliocentric(p: Pick<Planet, "j2000" | "perCentury">, T: number): [number, number, number] {
  const [a, e, iDeg, L, peri, node] = p.j2000.map((v, k) => v + p.perCentury[k]! * T) as Elements;
  const i = iDeg * D2R;
  const O = node * D2R;
  const w = (peri - node) * D2R;
  let M = ((((L - peri) % 360) + 540) % 360) - 180; // −180…180°
  M *= D2R;
  let E = M + e * Math.sin(M);
  for (let k = 0; k < 8; k++) E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
  const xp = a * (Math.cos(E) - e);
  const yp = a * Math.sqrt(1 - e * e) * Math.sin(E);
  const [cw, sw, cO, sO, ci, si] = [Math.cos(w), Math.sin(w), Math.cos(O), Math.sin(O), Math.cos(i), Math.sin(i)];
  return [
    (cw * cO - sw * sO * ci) * xp + (-sw * cO - cw * sO * ci) * yp,
    (cw * sO + sw * cO * ci) * xp + (-sw * sO + cw * cO * ci) * yp,
    sw * si * xp + cw * si * yp,
  ];
}

/** Unit direction Earth → body in the J2000 equatorial (≈ ICRF) frame. */
export function geocentricDirection(
  body: Pick<Planet, "j2000" | "perCentury">,
  julianDaysSinceJ2000: number,
): [number, number, number] {
  const T = julianDaysSinceJ2000 / 36525;
  const p = heliocentric(body, T);
  const earth = heliocentric(EARTH_MOON_BARYCENTRE, T);
  const [x, y, z] = [p[0] - earth[0], p[1] - earth[1], p[2] - earth[2]];
  const yq = Math.cos(OBLIQUITY) * y - Math.sin(OBLIQUITY) * z;
  const zq = Math.sin(OBLIQUITY) * y + Math.cos(OBLIQUITY) * z;
  const n = Math.hypot(x, yq, zq);
  return [x / n, yq / n, zq / n];
}

/** Direction Earth → Sun from the same elements (used to check the frames against Cesium's Sun). */
export function sunDirection(julianDaysSinceJ2000: number): [number, number, number] {
  const sun = { j2000: [0, 0, 0, 0, 0, 0] as Elements, perCentury: [0, 0, 0, 0, 0, 0] as Elements };
  return geocentricDirection(sun, julianDaysSinceJ2000);
}

/** Soft star sprite: a bright core with a short falloff, tinted per planet. */
function sprite(tint: string): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = c.height = 32;
  const ctx = c.getContext("2d");
  if (!ctx) return c;
  const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
  g.addColorStop(0, "#ffffff");
  g.addColorStop(0.18, tint);
  g.addColorStop(0.45, `${tint}55`);
  g.addColorStop(1, `${tint}00`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 32, 32);
  return c;
}

/**
 * Planets are drawn along their true direction from the camera (so no parallax: effectively at infinity), only
 * just beyond the far side of the Earth. The Earth still hides them correctly, and they stay inside the depth
 * range the globe already needs: placing them farther (e.g. at 250,000 km) makes Cesium split the scene into a
 * second frustum and draw it twice, which measured −17 fps.
 */
const BEYOND_EARTH = 1.2e7;
/**
 * Planets are drawn only when zoomed out this far: that is when sky is actually in view, and when the globe
 * is cheap to draw (few, coarse tiles), so regional and city views never pay for them.
 */
const SHOW_ABOVE = 6_000_000;
const HIT_PX = 12;

/**
 * Zoom-out reveal. Planets keep their true directions, but from most viewpoints none is behind the Earth, so
 * none is in frame. Past `from` the camera eases around the Earth (always still aimed at its centre, so zoom
 * and drag behave normally) until the nearest bright planet sits just beside the Earth's disc; zooming back in
 * eases it back to where the user was. Fully applied at `full`.
 */
const REVEAL = { from: 40_000_000, full: 90_000_000 } as const;
/** Reveal targets: naked-eye-bright planets, at least this far from the Sun (no staring into glare). */
const REVEAL_TARGETS = new Set(["Venus", "Mars", "Jupiter", "Saturn"]);
const MIN_ELONGATION = 45 * D2R;
/** Switch target only when another planet needs this much less camera travel (no flip-flopping). */
const SWITCH_MARGIN = 10 * D2R;
/** Names stay on (not just on hover) once the reveal is this far along. */
const NAMES_FROM = 0.4;
const EARTH_RADIUS = 6_371_000;
const smooth01 = (x: number) => {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
};

/** Adds the planets (and hover names for planets and the Moon). Returns a remover. */
export function addSolarSystem(Cesium: CesiumModule, viewer: Viewer): () => void {
  const { scene, camera } = viewer;
  const time: JulianDate = viewer.clock.currentTime;
  const days = Cesium.JulianDate.daysDifference(time, Cesium.JulianDate.fromIso8601("2000-01-01T12:00:00Z"));

  // ICRF/J2000 → Earth-fixed at the scene's (fixed) time. TEME ≈ J2000 to ~0.4° (precession since 2000).
  const toFixed =
    Cesium.Transforms.computeIcrfToFixedMatrix(time) ?? Cesium.Transforms.computeTemeToPseudoFixedMatrix(time);
  const fixedDir = (v: [number, number, number]): Cartesian3 =>
    Cesium.Matrix3.multiplyByVector(toFixed, new Cesium.Cartesian3(...v), new Cesium.Cartesian3());

  const billboards: BillboardCollection = scene.primitives.add(new Cesium.BillboardCollection({ scene }));
  const labels: LabelCollection = scene.primitives.add(new Cesium.LabelCollection({ scene }));
  const label = (text: string) =>
    labels.add({
      position: Cesium.Cartesian3.ZERO,
      text,
      show: false,
      font: "500 13px Geist, system-ui, sans-serif",
      fillColor: Cesium.Color.WHITE.withAlpha(0.92),
      showBackground: true,
      backgroundColor: Cesium.Color.fromCssColorString("rgba(8,12,24,0.7)"),
      backgroundPadding: new Cesium.Cartesian2(8, 4),
      pixelOffset: new Cesium.Cartesian2(0, -14),
      verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
    });

  const bodies = PLANETS.map((p) => ({
    dir: fixedDir(geocentricDirection(p, days)),
    billboard: billboards.add({
      position: Cesium.Cartesian3.ZERO,
      image: sprite(p.tint),
      width: p.size * 2.4,
      height: p.size * 2.4,
    }),
    label: label(p.name),
  }));

  // The Moon is drawn by Cesium at its true position and size; we only add its name on hover.
  const moonInertial = Cesium.Simon1994PlanetaryPositions.computeMoonPositionInEarthInertialFrame(time);
  const moonPos = Cesium.Matrix3.multiplyByVector(toFixed, moonInertial, new Cesium.Cartesian3());
  const moonLabel = label("Moon");
  moonLabel.position = moonPos;
  moonLabel.pixelOffset = new Cesium.Cartesian2(0, -24);

  // ---- zoom-out reveal ----
  const { Cartesian3, Matrix3, Matrix4, Quaternion } = Cesium;
  const sunFixed = Cartesian3.normalize(
    Matrix3.multiplyByVector(
      toFixed,
      Cesium.Simon1994PlanetaryPositions.computeSunPositionInEarthInertialFrame(time),
      new Cartesian3(),
    ),
    new Cartesian3(),
  );
  const targets = bodies.filter(
    (b, i) => REVEAL_TARGETS.has(PLANETS[i]!.name) && Cartesian3.angleBetween(b.dir, sunFixed) >= MIN_ELONGATION,
  );
  let applied = Quaternion.clone(Quaternion.IDENTITY);
  let target: (typeof bodies)[number] | null = null;
  let lastFrame = performance.now();
  const m3 = new Matrix3();
  const rotate = (q: Quaternion, v: Cartesian3) =>
    Matrix3.multiplyByVector(Matrix3.fromQuaternion(q, m3), v, new Cartesian3());

  /** Applies this frame's step of the reveal; returns how far along it is (0–1). */
  const reveal = (): number => {
    const now = performance.now();
    const dt = Math.min(0.1, (now - lastFrame) / 1000);
    lastFrame = now;
    // A scripted flight (camera.lookAt) owns the camera: forget our offset rather than fight it.
    if (!Matrix4.equals(camera.transform, Matrix4.IDENTITY)) {
      applied = Quaternion.clone(Quaternion.IDENTITY);
      return 0;
    }
    const undo = Quaternion.conjugate(applied, new Quaternion());
    const basePos = rotate(undo, camera.positionWC); // where the user's own camera is, without our offset
    const dist = Cartesian3.magnitude(basePos);
    const k = smooth01((dist - EARTH_RADIUS - REVEAL.from) / (REVEAL.full - REVEAL.from));
    const behind = Cartesian3.normalize(Cartesian3.negate(basePos, new Cartesian3()), new Cartesian3());
    const travel = (b: (typeof bodies)[number]) => Cartesian3.angleBetween(behind, b.dir);
    for (const b of targets) if (!target || travel(b) < travel(target) - SWITCH_MARGIN) target = b;

    let desired = Quaternion.IDENTITY;
    if (target && k > 0) {
      // Leave the planet just outside the Earth's disc, still well inside the frame.
      const earthRadiusAngle = Math.asin(Math.min(1, EARTH_RADIUS / dist));
      const goal = Math.min(earthRadiusAngle + 6 * D2R, 18 * D2R);
      const angle = Math.max(0, travel(target) - goal) * k;
      const axis = Cartesian3.cross(behind, target.dir, new Cartesian3());
      if (angle > 0 && Cartesian3.magnitude(axis) > 1e-9)
        desired = Quaternion.fromAxisAngle(Cartesian3.normalize(axis, axis), angle);
    }
    const next = Quaternion.slerp(applied, desired, Math.min(1, dt * 2.5), new Quaternion());
    const step = Quaternion.multiply(next, undo, new Quaternion());
    if (Math.abs(step.w) < 1 - 1e-12) {
      camera.setView({
        destination: rotate(step, camera.positionWC),
        orientation: { direction: rotate(step, camera.directionWC), up: rotate(step, camera.upWC) },
      });
    }
    applied = next;
    return k;
  };

  // Hover state is applied in the frame loop, where the always-on names are decided too.
  let hovered: { show: boolean } | null = null;

  // Pin each planet at a fixed distance from the camera along its direction, so it never shows parallax.
  const scratch = new Cesium.Cartesian3();
  const removePre = scene.preRender.addEventListener(() => {
    const k = reveal();
    const visible = camera.positionCartographic.height > SHOW_ABOVE;
    billboards.show = labels.show = visible;
    if (!visible) return;
    const names = k >= NAMES_FROM;
    for (const b of bodies) b.label.show = names || hovered === b.label;
    moonLabel.show = hovered === moonLabel;
    const skyDistance = Cesium.Cartesian3.magnitude(camera.positionWC) + BEYOND_EARTH;
    for (const b of bodies) {
      Cesium.Cartesian3.multiplyByScalar(b.dir, skyDistance, scratch);
      Cesium.Cartesian3.add(camera.positionWC, scratch, scratch);
      b.billboard.position = scratch;
      b.label.position = scratch;
    }
  });

  // Hover names via a cheap screen-distance test (no GPU pick). Hidden bodies (behind the Earth) are
  // excluded with an ellipsoid occlusion test.
  const occluder = () => new Cesium.EllipsoidalOccluder(Cesium.Ellipsoid.WGS84, camera.positionWC);
  const handler = new Cesium.ScreenSpaceEventHandler(scene.canvas);
  const hide = () => {
    hovered = null;
  };
  handler.setInputAction((e: { endPosition: Cartesian2 }) => {
    if (!billboards.show) return hide();
    const occ = occluder();
    let hit: { show: boolean } | null = null;
    const near = (pos: Cartesian3, radiusPx = HIT_PX) => {
      if (!occ.isPointVisible(pos)) return false;
      const px = Cesium.SceneTransforms.worldToWindowCoordinates(scene, pos);
      return !!px && Cesium.Cartesian2.distance(px, e.endPosition) <= radiusPx;
    };
    for (const b of bodies) if (near(b.billboard.position)) hit = b.label;
    if (!hit && near(moonPos, 20)) hit = moonLabel;
    hovered = hit;
  }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
  scene.canvas.addEventListener("pointerleave", hide);

  return () => {
    removePre();
    if (!handler.isDestroyed()) handler.destroy();
    if (viewer.isDestroyed()) return;
    scene.canvas.removeEventListener("pointerleave", hide);
    scene.primitives.remove(billboards);
    scene.primitives.remove(labels);
  };
}
