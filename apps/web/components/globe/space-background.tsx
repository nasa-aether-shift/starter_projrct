export function SpaceBackground() {
  return (
    <div aria-hidden className="space-background pointer-events-none">
      <div className="space-background__stars space-background__stars--far" />
      <div className="space-background__stars space-background__stars--near" />
      <div className="space-background__shade" />
    </div>
  );
}
