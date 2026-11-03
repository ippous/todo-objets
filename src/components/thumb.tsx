import { TaskIcon } from "@/lib/task-icons";

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

/** Vignette d'une tâche : sa photo de couverture, sinon l'icône de son type. */
export function TaskThumb({
  photoId,
  icon,
  size = 40,
  className = "",
}: {
  photoId: string | null | undefined;
  icon: string | null | undefined;
  size?: number;
  className?: string;
}) {
  if (photoId) return <Thumb photoId={photoId} size={size} className={className} />;
  if (!icon) return null;
  return (
    <span
      className={`grid shrink-0 place-items-center rounded-md bg-moss-soft text-moss ${className}`}
      style={{ width: size, height: size }}
    >
      <TaskIcon icon={icon} size={Math.round(size * 0.55)} />
    </span>
  );
}
