// Space intro for the home page: a spiral galaxy, a dive to the Sun, a pass by two planets and an approach to
// Earth that ends on exactly the view the Cesium globe starts with (START_VIEW, Cesium's field of view, the
// globe's on-screen box and the same fixed sun), so the live globe can fade in underneath without a jump.
// Decorative only: no data is shown and nothing is fetched except the committed Blue Marble image.
// Framework-free; React wraps it in components/intro/space-intro.tsx.

import {
  AdditiveBlending,
  AmbientLight,
  BufferGeometry,
  CanvasTexture,
  CatmullRomCurve3,
  Color,
  DirectionalLight,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  Points,
  PointsMaterial,
  RingGeometry,
  SRGBColorSpace,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  TextureLoader,
  Vector3,
  WebGLRenderer,
  type Texture,
} from "three";

import { START_VIEW, demoSunTime } from "@/lib/cesium/config";

/** Seconds from the galaxy to the globe's start view; the overlay fade follows (components/intro). */
export const FLIGHT_S = 10.5;

/** NASA Blue Marble, equirectangular, fetched once from GIBS WMS and committed (no live calls). */
const EARTH_TEXTURE = "/images/intro/blue-marble-2048.jpg";
/** One scene unit is Earth's equatorial radius (WGS84), so the final distance matches Cesium's height. */
const R_EQ_M = 6_378_137;
/** Cesium's default field of view: horizontal on wide canvases (Camera/PerspectiveFrustum). */
const CESIUM_FOV = Math.PI / 3;
const D2R = Math.PI / 180;
const UP = new Vector3(0, 1, 0);
const ORIGIN = new Vector3(0, 0, 0);

export interface IntroOptions {
  /** The live globe's box in viewport pixels; the last frame is projected exactly like it. */
  frame: () => DOMRect | null;
  /** First frame drawn. */
  onStart: () => void;
  /** The flight has reached the globe's start view (called once). */
  onArrive: () => void;
}

export interface IntroHandle {
  destroy: () => void;
}

const smoothstep = (edge0: number, edge1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Unit vector for a latitude/longitude in Three's sphere UV layout: lon 0 at +X, 90°E at −Z, north +Y. */
function earthDir(latDeg: number, lonDeg: number): Vector3 {
  const lat = latDeg * D2R;
  const lon = lonDeg * D2R;
  return new Vector3(Math.cos(lat) * Math.cos(lon), Math.sin(lat), -Math.cos(lat) * Math.sin(lon));
}

/** Where the sun is overhead (NOAA low-precision formulas, about ±0.5°), so Earth is lit like the Cesium globe. */
function subsolarPoint(date: Date): { lat: number; lon: number } {
  const hours = date.getUTCHours() + date.getUTCMinutes() / 60;
  const g = ((2 * Math.PI) / 365) * ((date.getTime() - Date.UTC(date.getUTCFullYear(), 0, 1)) / 86_400_000 - 0.5);
  const eqTimeMin =
    229.18 *
    (0.000075 +
      0.001868 * Math.cos(g) -
      0.032077 * Math.sin(g) -
      0.014615 * Math.cos(2 * g) -
      0.040849 * Math.sin(2 * g));
  const decl =
    0.006918 -
    0.399912 * Math.cos(g) +
    0.070257 * Math.sin(g) -
    0.006758 * Math.cos(2 * g) +
    0.000907 * Math.sin(2 * g) -
    0.002697 * Math.cos(3 * g) +
    0.00148 * Math.sin(3 * g);
  return { lat: decl / D2R, lon: -(hours * 60 + eqTimeMin - 720) / 4 };
}

/** Cesium's vertical field of view for a canvas aspect ratio. */
function cesiumFovy(aspect: number): number {
  return aspect <= 1 ? CESIUM_FOV : 2 * Math.atan(Math.tan(CESIUM_FOV / 2) / aspect);
}

/** Seeded random numbers, so the galaxy looks the same on every visit. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/**
 * Time → keyframe index through (times[i], i) as a monotone cubic (Fritsch–Butland slopes, zero at both
 * ends): each keyframe is reached at its time, speed never jumps, and the flight eases in and out.
 */
function keyframeClock(times: number[]): (t: number) => number {
  const n = times.length;
  const d = times.slice(1).map((t, i) => 1 / (t - times[i]));
  const m = times.map((_, i) => (i === 0 || i === n - 1 ? 0 : (2 * d[i - 1] * d[i]) / (d[i - 1] + d[i])));
  return (t) => {
    if (t <= times[0]) return 0;
    if (t >= times[n - 1]) return n - 1;
    let i = 0;
    while (t > times[i + 1]) i++;
    const h = times[i + 1] - times[i];
    const s = (t - times[i]) / h;
    const s2 = s * s;
    const s3 = s2 * s;
    return (
      (2 * s3 - 3 * s2 + 1) * i + (s3 - 2 * s2 + s) * h * m[i] + (3 * s2 - 2 * s3) * (i + 1) + (s3 - s2) * h * m[i + 1]
    );
  };
}

/** sRGB components of a 0xRRGGBB colour (the galaxy shader writes them straight to the screen). */
const rgb = (hex: number): [number, number, number] => [
  ((hex >> 16) & 255) / 255,
  ((hex >> 8) & 255) / 255,
  (hex & 255) / 255,
];

function canvasTexture(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (ctx) draw(ctx);
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  return tex;
}

/** Round soft sprite: radial gradient stops from the centre (0) to the edge (1). */
function radialTexture(stops: [number, string][]): CanvasTexture {
  return canvasTexture(256, 256, (ctx) => {
    const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
    for (const [at, color] of stops) g.addColorStop(at, color);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 256, 256);
  });
}

const GALAXY_VERTEX = /* glsl */ `
  uniform float uSize;
  uniform float uScale;
  uniform float uMaxPx;
  attribute float aSize;
  attribute vec3 aColor;
  varying vec3 vColor;
  void main() {
    vColor = aColor;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = clamp(uSize * aSize * uScale / -mv.z, 0.0, uMaxPx);
  }
`;

const GALAXY_FRAGMENT = /* glsl */ `
  uniform float uOpacity;
  varying vec3 vColor;
  void main() {
    float a = (1.0 - smoothstep(0.0, 0.5, length(gl_PointCoord - 0.5))) * uOpacity;
    gl_FragColor = vec4(vColor * a, a);
  }
`;

/** Spiral galaxy of soft additive points around `center`, in the plane through it with normal +Y. */
function makeGalaxy(rand: () => number, center: Vector3, sun: Vector3, pixelRatio: number) {
  const COUNT = 40_000;
  const RADIUS = 3_500;
  const ARMS = 4;
  const TWIST = 4 / RADIUS; // radians of arm twist per unit of radius
  const inner = rgb(0xffd59e);
  const outer = rgb(0x7aa7ff);
  const nebula = rgb(0xff8fc4);
  const positions: number[] = [];
  const colors: number[] = [];
  const sizes: number[] = [];
  const signed = (power: number) => Math.pow(rand(), power) * (rand() < 0.5 ? -1 : 1);
  const p = new Vector3();
  for (let i = 0; i < COUNT; i++) {
    if (i < COUNT * 0.15) {
      // Bulge: a flattened ball of old, warm stars.
      const r = Math.pow(rand(), 2) * RADIUS * 0.2;
      p.set(signed(1), signed(1) * 0.4, signed(1))
        .normalize()
        .multiplyScalar(r);
    } else {
      const r = rand() * RADIUS;
      const angle = ((i % ARMS) / ARMS) * Math.PI * 2 + r * TWIST;
      const spread = 0.35 * r;
      p.set(
        Math.cos(angle) * r + signed(3) * spread,
        signed(3) * (15 + 60 * (1 - r / RADIUS)),
        Math.sin(angle) * r + signed(3) * spread,
      );
    }
    p.add(center);
    if (p.distanceTo(sun) < 150) continue; // keep the Sun's neighbourhood clear for the fly-through
    const k = Math.min(1, p.distanceTo(center) / RADIUS);
    const c =
      rand() < 0.03 && k > 0.3
        ? nebula
        : [lerp(inner[0], outer[0], k), lerp(inner[1], outer[1], k), lerp(inner[2], outer[2], k)];
    positions.push(p.x, p.y, p.z);
    colors.push(c[0], c[1], c[2]);
    sizes.push(0.6 + rand() * 1.2);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("aColor", new Float32BufferAttribute(colors, 3));
  geometry.setAttribute("aSize", new Float32BufferAttribute(sizes, 1));
  const material = new ShaderMaterial({
    uniforms: {
      uSize: { value: 26 },
      uScale: { value: 1 },
      uMaxPx: { value: 5 * pixelRatio },
      uOpacity: { value: 1 },
    },
    vertexShader: GALAXY_VERTEX,
    fragmentShader: GALAXY_FRAGMENT,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  });
  return { points: new Points(geometry, material), material };
}

/** Distant background stars on a sphere around the scene (fixed pixel size). */
function makeStarfield(rand: () => number): Points {
  const positions: number[] = [];
  const v = new Vector3();
  for (let i = 0; i < 2_500; i++) {
    v.set(rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1);
    if (v.lengthSq() > 1 || v.lengthSq() < 1e-4) continue;
    v.normalize().multiplyScalar(20_000);
    positions.push(v.x, v.y, v.z);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  return new Points(
    geometry,
    new PointsMaterial({
      color: 0xdfe6ff,
      size: 1.5,
      sizeAttenuation: false,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
    }),
  );
}

export function createIntro(container: HTMLElement, opts: IntroOptions): IntroHandle {
  const renderer = new WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.setClearColor(0x000000, 1);
  container.appendChild(renderer.domElement);

  const scene = new Scene();
  const camera = new PerspectiveCamera(60, 1, 0.01, 60_000);
  camera.up.copy(UP); // north stays up, like Cesium's heading-0 start view
  const textures: Texture[] = [];
  const rand = mulberry32(20_261_115);
  let disposed = false;

  // ---- layout (scene units = Earth radii; Earth at the origin, north +Y). Not to scale. ----
  const sun = subsolarPoint(demoSunTime());
  const s = earthDir(sun.lat, sun.lon); // Earth → Sun
  const SUN = s.clone().multiplyScalar(600);
  const f = s.clone().negate(); // Sun → Earth: the route
  const side = new Vector3().crossVectors(f, UP).normalize();
  const lift = new Vector3().crossVectors(side, f).normalize();
  const along = (k: number, sideways = 0, up = 0) =>
    SUN.clone().addScaledVector(f, k).addScaledVector(side, sideways).addScaledVector(lift, up);
  const toward = new Vector3(f.x, 0, f.z).normalize();
  const GALAXY_CENTER = SUN.clone().addScaledVector(toward, 2_200); // the Sun sits about 60% out in the disc
  const GIANT = along(230, -48, 8); // far enough off the route that the whole ringed planet stays in view
  const ROCKY = along(470, 3, -1.5);
  const view = earthDir(START_VIEW.lat, START_VIEW.lon);
  const END = view.clone().multiplyScalar((R_EQ_M + START_VIEW.height) / R_EQ_M);

  // ---- light: one fixed sun, from the same direction as the Cesium globe's demo sun ----
  const light = new DirectionalLight(0xffffff, 3);
  light.position.copy(s);
  scene.add(light, new AmbientLight(0x223355, 0.08));

  // ---- galaxy, background stars ----
  const galaxy = makeGalaxy(rand, GALAXY_CENTER, SUN, renderer.getPixelRatio());
  scene.add(galaxy.points, makeStarfield(rand));

  // ---- the Sun ----
  const glowTex = radialTexture([
    [0, "rgba(255,255,255,1)"],
    [0.2, "rgba(255,236,200,0.55)"],
    [1, "rgba(255,200,140,0)"],
  ]);
  textures.push(glowTex);
  const sunGlow = new Sprite(
    new SpriteMaterial({
      map: glowTex,
      color: 0xffd9a0,
      blending: AdditiveBlending,
      depthWrite: false,
      transparent: true,
    }),
  );
  sunGlow.position.copy(SUN);
  const sunCore = new Mesh(new SphereGeometry(8, 32, 16), new MeshBasicMaterial({ color: 0xfff3d6 }));
  sunCore.position.copy(SUN);
  scene.add(sunCore, sunGlow);

  // ---- a ringed gas giant (banded texture drawn here, no image files) ----
  const bandsTex = canvasTexture(512, 256, (ctx) => {
    const palette = [0xe9d6b0, 0xc9a27a, 0xf2e6cc, 0xa8714f, 0xdcc19a].map((h) => new Color(h));
    const c = new Color();
    for (let y = 0; y < 256; y++) {
      const k = ((Math.sin(y * 0.13) + 0.6 * Math.sin(y * 0.047 + 1.3) + 1.6) / 3.2) * (palette.length - 1);
      const i = Math.min(palette.length - 2, Math.max(0, Math.floor(k)));
      ctx.fillStyle = c.lerpColors(palette[i], palette[i + 1], k - i).getStyle();
      ctx.fillRect(0, y, 512, 1);
    }
    ctx.fillStyle = "rgba(190,110,80,0.55)";
    ctx.beginPath();
    ctx.ellipse(330, 165, 34, 14, 0, 0, Math.PI * 2);
    ctx.fill();
  });
  textures.push(bandsTex);
  const giant = new Group();
  giant.position.copy(GIANT);
  giant.rotation.z = 0.42;
  giant.add(new Mesh(new SphereGeometry(7, 64, 32), new MeshStandardMaterial({ map: bandsTex, roughness: 1 })));
  for (const [innerR, outerR, opacity] of [
    [9, 11.6, 0.5],
    [12.1, 14.5, 0.28],
  ] as const) {
    const ring = new Mesh(
      new RingGeometry(innerR, outerR, 128),
      new MeshBasicMaterial({ color: 0xd9c6a2, transparent: true, opacity, side: DoubleSide, depthWrite: false }),
    );
    ring.rotation.x = -Math.PI / 2;
    giant.add(ring);
  }
  scene.add(giant);

  // ---- a small red rocky planet ----
  const rustTex = canvasTexture(256, 128, (ctx) => {
    ctx.fillStyle = "#b4542f";
    ctx.fillRect(0, 0, 256, 128);
    for (let i = 0; i < 260; i++) {
      ctx.fillStyle = rand() < 0.5 ? "rgba(120,45,25,0.35)" : "rgba(220,140,90,0.25)";
      ctx.beginPath();
      ctx.arc(rand() * 256, 10 + rand() * 108, 2 + rand() * 10, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = "rgba(255,255,255,0.8)";
    ctx.fillRect(0, 0, 256, 5);
    ctx.fillRect(0, 123, 256, 5);
  });
  textures.push(rustTex);
  const rocky = new Mesh(new SphereGeometry(0.55, 48, 24), new MeshStandardMaterial({ map: rustTex, roughness: 1 }));
  rocky.position.copy(ROCKY);
  scene.add(rocky);

  // ---- Earth: Blue Marble on a unit sphere, plus a thin atmosphere rim (a sprite the sphere hides inside) ----
  const earthMat = new MeshStandardMaterial({ color: 0x0b1f3a, roughness: 0.85, metalness: 0 });
  new TextureLoader().load(EARTH_TEXTURE, (tex) => {
    if (disposed) {
      tex.dispose();
      return;
    }
    tex.colorSpace = SRGBColorSpace;
    tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    textures.push(tex);
    earthMat.map = tex;
    earthMat.color.set(0xffffff);
    earthMat.needsUpdate = true;
  });
  scene.add(new Mesh(new SphereGeometry(1, 96, 64), earthMat));
  const haloTex = radialTexture([
    [0, "rgba(140,190,255,0.75)"],
    [0.86, "rgba(140,190,255,0.75)"],
    [0.9, "rgba(110,170,255,0.45)"],
    [1, "rgba(80,140,255,0)"],
  ]);
  textures.push(haloTex);
  const halo = new Sprite(
    new SpriteMaterial({ map: haloTex, blending: AdditiveBlending, depthWrite: false, transparent: true }),
  );
  halo.scale.setScalar(2.24);
  scene.add(halo);

  // ---- flight: camera positions and aim points per keyframe (seconds) ----
  const keys = [
    { t: 0, pos: GALAXY_CENTER.clone().addScaledVector(toward, -6_500).addScaledVector(UP, 9_500), aim: GALAXY_CENTER },
    { t: 3.2, pos: along(-220, 0, 60), aim: SUN },
    { t: 4.4, pos: along(70, 35, 10), aim: along(230, -30, 6) },
    { t: 5.8, pos: along(240, -6, 6), aim: along(420) },
    { t: 7.0, pos: along(465, 1.2, 0), aim: ORIGIN },
    { t: 8.6, pos: view.clone().multiplyScalar(26), aim: ORIGIN },
    { t: FLIGHT_S, pos: END, aim: ORIGIN },
  ];
  const path = new CatmullRomCurve3(keys.map((k) => k.pos));
  const aims = new CatmullRomCurve3(keys.map((k) => k.aim.clone()));
  const clock = keyframeClock(keys.map((k) => k.t));
  const aim = new Vector3();

  /**
   * Project like the target box. Early on that is the whole screen; over the approach it becomes the globe's
   * box (on wide screens it extends past the right edge), with Cesium's field of view for that box, so the
   * last frame and the globe's first frame line up.
   */
  const frameCamera = (t: number) => {
    const w = container.clientWidth;
    const h = container.clientHeight;
    const box = opts.frame();
    const k = box ? smoothstep(7.4, FLIGHT_S, t) : 0;
    const fx = lerp(0, box?.left ?? 0, k);
    const fy = lerp(0, box?.top ?? 0, k);
    const fw = lerp(w, box?.width ?? w, k);
    const fh = lerp(h, box?.height ?? h, k);
    const fovy = cesiumFovy(fw / fh);
    camera.fov = fovy / D2R;
    camera.aspect = fw / fh;
    camera.setViewOffset(fw, fh, -fx, -fy, w, h); // also updates the projection matrix
    galaxy.material.uniforms.uScale.value = (fh * renderer.getPixelRatio()) / (2 * Math.tan(fovy / 2));
  };

  const onResize = () => renderer.setSize(container.clientWidth, container.clientHeight);
  window.addEventListener("resize", onResize);

  let start = -1;
  let arrived = false;
  renderer.setAnimationLoop((now: number) => {
    if (start < 0) {
      start = now;
      opts.onStart();
    }
    const t = Math.min((now - start) / 1000, FLIGHT_S);
    const u = clock(t) / (keys.length - 1);
    camera.position.copy(path.getPoint(u));
    camera.lookAt(aims.getPoint(u, aim));
    frameCamera(t);

    const galaxyOpacity = 1 - smoothstep(2.4, 4.0, t); // gone once we are among the planets
    galaxy.material.uniforms.uOpacity.value = galaxyOpacity;
    galaxy.points.visible = galaxyOpacity > 0.001;
    sunGlow.scale.setScalar(Math.min(110, camera.position.distanceTo(SUN) * 0.8)); // no white-out up close

    renderer.render(scene, camera);
    if (!arrived && t >= FLIGHT_S) {
      arrived = true;
      opts.onArrive();
    }
  });

  return {
    destroy: () => {
      disposed = true;
      renderer.setAnimationLoop(null);
      window.removeEventListener("resize", onResize);
      scene.traverse((obj) => {
        if (obj instanceof Mesh || obj instanceof Points) obj.geometry.dispose(); // Sprite geometry is shared by three
        if (obj instanceof Mesh || obj instanceof Points || obj instanceof Sprite) {
          const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
          for (const m of mats) m.dispose();
        }
      });
      for (const tex of textures) tex.dispose();
      renderer.dispose();
      renderer.forceContextLoss(); // free the WebGL context now, not at garbage collection
      renderer.domElement.remove();
    },
  };
}
