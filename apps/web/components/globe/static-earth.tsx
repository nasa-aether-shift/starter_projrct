import Image from "next/image";

/**
 * Static fallback (NEXT_PUBLIC_GLOBE_MODE=static, or when WebGL/Cesium fails).
 * NASA Blue Marble Shaded Relief + Bathymetry, fetched once from GIBS WMS and committed to /public.
 */
export function StaticEarth({ className }: { className?: string }) {
  return (
    <div className={`relative h-full w-full overflow-hidden bg-black ${className ?? ""}`}>
      <Image
        src="/images/earth-africa.jpg"
        alt="Satellite view of Africa and the Atlantic Ocean from NASA's Blue Marble imagery"
        fill
        priority
        sizes="100vw"
        className="object-cover object-[35%_45%]"
      />
      <p className="absolute right-3 bottom-2 text-xs text-white/70">NASA Blue Marble (GIBS)</p>
    </div>
  );
}
