/** Vignette carrée d'un objet ou d'une tâche (rien si pas de photo). */
export function Thumb({ photoId, size = 40, className = "" }: { photoId: string | null | undefined; size?: number; className?: string }) {
  if (!photoId) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`/api/photos/${photoId}?v=1`}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      className={`shrink-0 rounded-md bg-moss-soft object-cover ${className}`}
      style={{ width: size, height: size }}
    />
  );
}
