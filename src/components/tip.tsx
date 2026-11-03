"use client";

// Info-bulle pour les boutons en icône seule (mobile) :
// - souris : au survol, après un court délai ;
// - clavier : quand le bouton reçoit le focus ;
// - tactile : appui long (le bouton n'est alors pas déclenché), effacée au bout de 1,5 s.
// Le nom accessible reste porté par le bouton (aria-label) : la bulle n'est qu'un rappel visuel.
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

const HOVER_DELAY = 350;
const LONG_PRESS = 450;
const TOUCH_HIDE = 1500;

export function Tip({
  label,
  children,
  className = "",
  always = false,
}: {
  label: string;
  children: ReactNode;
  className?: string;
  /** Par défaut la bulle ne sert que sous la largeur « sm », là où le texte du bouton est masqué. */
  always?: boolean;
}) {
  const wrap = useRef<HTMLSpanElement>(null);
  const bubble = useRef<HTMLSpanElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressed = useRef(false);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  /** Affiche la bulle ; faux si elle n'a pas lieu d'être (texte visible à cette largeur). */
  const show = (): boolean => {
    if (!always && window.matchMedia("(min-width: 40rem)").matches) return false;
    const r = wrap.current?.getBoundingClientRect();
    if (!r) return false;
    setPos({ left: r.left + r.width / 2, top: r.top });
    setOpen(true);
    return true;
  };
  const hide = () => {
    clear();
    setOpen(false);
  };

  // Garde la bulle dans l'écran (bords gauche et droit)
  useLayoutEffect(() => {
    const b = bubble.current;
    if (!open || !b || !pos) return;
    const w = b.offsetWidth;
    const left = Math.min(Math.max(pos.left, w / 2 + 8), window.innerWidth - w / 2 - 8);
    if (Math.abs(left - pos.left) > 0.5) setPos({ ...pos, left });
  }, [open, pos]);

  return (
    <span
      ref={wrap}
      className={`inline-flex ${className}`}
      onPointerEnter={(e) => {
        if (e.pointerType !== "mouse") return;
        clear();
        timer.current = setTimeout(show, HOVER_DELAY);
      }}
      onPointerLeave={(e) => {
        if (e.pointerType === "mouse") hide();
      }}
      onPointerDown={(e) => {
        if (e.pointerType === "mouse") return hide();
        longPressed.current = false;
        clear();
        timer.current = setTimeout(() => {
          timer.current = null;
          if (!show()) return;
          longPressed.current = true;
          timer.current = setTimeout(() => setOpen(false), TOUCH_HIDE);
        }, LONG_PRESS);
      }}
      onPointerUp={(e) => {
        if (e.pointerType !== "mouse" && !longPressed.current) clear();
      }}
      onPointerCancel={hide}
      // Après un appui long, le relâchement ne déclenche pas le bouton
      onClickCapture={(e) => {
        if (longPressed.current) {
          e.preventDefault();
          e.stopPropagation();
          longPressed.current = false;
        }
      }}
      onContextMenu={(e) => {
        if (longPressed.current || timer.current) e.preventDefault();
      }}
      onFocus={(e) => {
        if ((e.target as HTMLElement).matches(":focus-visible")) show();
      }}
      onBlur={hide}
    >
      {children}
      {open && pos && (
        <span
          ref={bubble}
          aria-hidden
          className="pointer-events-none fixed z-50 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-md bg-ink px-2 py-1 text-xs font-bold text-surface shadow-lg"
          style={{ left: pos.left, top: pos.top - 6 }}
        >
          {label}
        </span>
      )}
    </span>
  );
}

/** Contenu d'un bouton d'action : icône seule sur mobile, icône et texte à partir de la largeur « sm ». */
export function IconLabel({ icon, label }: { icon: ReactNode; label: ReactNode }) {
  return (
    <>
      {icon}
      <span className="hidden sm:inline" aria-hidden>
        {label}
      </span>
    </>
  );
}
