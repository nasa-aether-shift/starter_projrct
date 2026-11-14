// Vector demarcations on the globe: country borders, the focus country (Ghana) highlighted, and its
// regions with names, each appearing at a sensible zoom. Crisp at every height (unlike raster tiles).

import type { Entity } from "cesium";

import { env } from "@/lib/env";
import type { Boundaries } from "@/lib/geo/boundaries";

import type { GlobeHandle } from "./create-globe";

const SHOW = {
  countriesBelow: 14_000_000,
  countryLabels: [250_000, 7_000_000] as const,
  focusBelow: 20_000_000,
  regionsBelow: 2_200_000,
  regionLabels: [40_000, 1_400_000] as const,
};

/** Draws borders and labels; returns a remover. */
export function addBoundaries(globe: GlobeHandle, b: Boundaries): () => void {
  const { Cesium, viewer } = globe;
  const C = Cesium;
  const entities: Entity[] = [];
  const clamp = Boolean(env.cesiumIonToken); // drape on real terrain; on the ellipsoid plain lines are enough
  const dd = (near: number, far: number) => new C.DistanceDisplayCondition(near, far);
  const positions = (r: [number, number][]) => C.Cartesian3.fromDegreesArray(r.flat());

  const label = (text: string, [lon, lat]: [number, number], range: readonly [number, number], big: boolean) =>
    viewer.entities.add({
      position: C.Cartesian3.fromDegrees(lon, lat),
      label: {
        text,
        font: big ? "700 15px Geist, system-ui, sans-serif" : "500 13px Geist, system-ui, sans-serif",
        fillColor: C.Color.WHITE.withAlpha(big ? 0.95 : 0.85),
        outlineColor: C.Color.BLACK.withAlpha(0.85),
        outlineWidth: 3,
        style: C.LabelStyle.FILL_AND_OUTLINE,
        horizontalOrigin: C.HorizontalOrigin.CENTER,
        verticalOrigin: C.VerticalOrigin.CENTER,
        distanceDisplayCondition: dd(range[0], range[1]),
        scaleByDistance: new C.NearFarScalar(300_000, 1.1, 6_000_000, 0.8),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });

  for (const c of b.countries) {
    const focus = c.iso === b.focusCountry;
    for (const r of c.rings) {
      entities.push(
        viewer.entities.add({
          polyline: {
            positions: positions(r),
            width: focus ? 5 : 1.6,
            material: focus
              ? new C.PolylineGlowMaterialProperty({
                  color: C.Color.fromCssColorString("#e6f7ff"),
                  glowPower: 0.2,
                  taperPower: 1,
                })
              : C.Color.WHITE.withAlpha(0.7),
            arcType: C.ArcType.GEODESIC,
            clampToGround: clamp,
            distanceDisplayCondition: dd(0, focus ? SHOW.focusBelow : SHOW.countriesBelow),
          },
        }),
      );
    }
    entities.push(label(focus ? c.name.toUpperCase() : c.name, c.label, SHOW.countryLabels, focus));
  }

  for (const r of b.regions) {
    for (const ring of r.rings) {
      entities.push(
        viewer.entities.add({
          polyline: {
            positions: positions(ring),
            width: 1.4,
            material: new C.PolylineDashMaterialProperty({ color: C.Color.WHITE.withAlpha(0.6), dashLength: 10 }),
            arcType: C.ArcType.GEODESIC,
            clampToGround: clamp,
            distanceDisplayCondition: dd(0, SHOW.regionsBelow),
          },
        }),
      );
    }
    entities.push(label(`${r.name} Region`, r.label, SHOW.regionLabels, false));
  }

  return () => {
    if (viewer.isDestroyed()) return;
    for (const e of entities) viewer.entities.remove(e);
  };
}
