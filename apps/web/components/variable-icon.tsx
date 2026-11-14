import { variableMeta } from "@/lib/variable-meta";

const SIZES = {
  sm: { box: "size-8 rounded-lg", icon: "size-4" },
  md: { box: "size-11 rounded-xl", icon: "size-5" },
  lg: { box: "size-14 rounded-2xl", icon: "size-7" },
} as const;

/** Icon tile tinted with the variable's accent. Decorative: callers always render the name as text. */
export function VariableIcon({
  id,
  size = "md",
  active = false,
}: {
  id: string;
  size?: keyof typeof SIZES;
  active?: boolean;
}) {
  const { Icon, accent } = variableMeta(id);
  const s = SIZES[size];
  return (
    <span
      aria-hidden
      className={`flex shrink-0 items-center justify-center border transition-colors ${s.box}`}
      style={{
        color: active ? "#0b1020" : accent,
        background: active ? accent : `color-mix(in oklab, ${accent} 16%, transparent)`,
        borderColor: `color-mix(in oklab, ${accent} ${active ? 100 : 40}%, transparent)`,
      }}
    >
      <Icon className={s.icon} strokeWidth={2.2} />
    </span>
  );
}
