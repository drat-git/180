import { useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Menu } from "lucide-react";

type Gesture = {
  card: HTMLElement;
  pointerId?: number;
  y: number;
  grabOffset: number;
  offset: number;
  active: boolean;
  moved: boolean;
  cleanup: () => void;
};

/** Only the handle owns the gesture; the rest of each card keeps normal scrolling. */
export function ReorderHandle({
  label,
  first,
  last,
  disabled = false,
  onMove,
  onStart,
  onEnd,
}: {
  label: string;
  first: boolean;
  last: boolean;
  disabled?: boolean;
  onMove: (direction: -1 | 1) => void;
  onStart: () => void;
  onEnd: (cancelled: boolean, moved: boolean) => void;
}) {
  const [active, setActive] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const latest = useRef({ first, last, onMove, onStart, onEnd });
  const finishRef = useRef<(cancelled: boolean) => void>(() => {});

  function finish(cancelled: boolean) {
    const current = gesture.current;
    if (!current) return;
    gesture.current = null;
    current.cleanup();
    current.card.classList.remove("is-reordering");
    current.card.style.removeProperty("--reorder-offset");
    setActive(false);
    if (current.active) latest.current.onEnd(cancelled, current.moved);
  }
  finishRef.current = finish;

  function positionCard(current: Gesture) {
    const layoutTop = current.card.getBoundingClientRect().top - current.offset;
    current.offset = current.y - current.grabOffset - layoutTop;
    current.card.style.setProperty("--reorder-offset", `${current.offset}px`);
  }

  useLayoutEffect(() => {
    latest.current = { first, last, onMove, onStart, onEnd };
    const current = gesture.current;
    if (current?.active && current.pointerId !== undefined)
      positionCard(current);
    else if (current?.active) button.current?.focus({ preventScroll: true });
  });
  useLayoutEffect(
    () => () => {
      const current = gesture.current;
      current?.cleanup();
      current?.card.classList.remove("is-reordering");
      current?.card.style.removeProperty("--reorder-offset");
    },
    [],
  );

  function move(direction: -1 | 1) {
    if (direction === -1 ? latest.current.first : latest.current.last) return;
    if (gesture.current) gesture.current.moved = true;
    // The next hit test needs the new sibling positions, including on a fast drop.
    flushSync(() => latest.current.onMove(direction));
  }

  return (
    <>
      <button
        ref={button}
        type="button"
        className="customization-small-button customization-reorder-handle"
        aria-label={`Reorder ${label}`}
        aria-pressed={active}
        title="Hold to drag. With a keyboard, press Space, then use the arrow keys."
        disabled={disabled || (first && last)}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
        onContextMenu={(event) => event.preventDefault()}
        onPointerDown={(event) => {
          if (!event.isPrimary || event.button !== 0 || gesture.current) return;
          const card = event.currentTarget.closest<HTMLElement>(
            "[data-reorder-card]",
          );
          if (!card) return;
          event.preventDefault();
          event.stopPropagation();
          event.currentTarget.focus({ preventScroll: true });
          const pointerId = event.pointerId;
          let frame = 0;
          const current: Gesture = {
            card,
            pointerId,
            y: event.clientY,
            grabOffset: event.clientY - card.getBoundingClientRect().top,
            offset: 0,
            active: false,
            moved: false,
            cleanup: () => {},
          };
          gesture.current = current;
          const tick = () => {
            if (gesture.current !== current || !current.active) return;
            const dialog = card.closest("dialog");
            if (dialog) {
              const bounds = dialog.getBoundingClientRect();
              const footer =
                dialog
                  .querySelector(".customization-save")
                  ?.getBoundingClientRect().height ?? 0;
              const top = bounds.top + 48;
              const bottom = bounds.bottom - footer - 48;
              const scroll =
                current.y < top
                  ? -Math.min(14, (top - current.y) / 4)
                  : current.y > bottom
                    ? Math.min(14, (current.y - bottom) / 4)
                    : 0;
              if (scroll) dialog.scrollTop += scroll;
            }
            positionCard(current);
            const siblings = Array.from(
              card.parentElement?.children ?? [],
            ).filter(
              (element): element is HTMLElement =>
                element instanceof HTMLElement &&
                element.hasAttribute("data-reorder-card"),
            );
            const index = siblings.indexOf(card);
            const previous = siblings[index - 1]?.getBoundingClientRect();
            const next = siblings[index + 1]?.getBoundingClientRect();
            if (previous && current.y < previous.top + previous.height / 2)
              move(-1);
            else if (next && current.y > next.top + next.height / 2) move(1);
            frame = requestAnimationFrame(tick);
          };
          const timer = window.setTimeout(() => {
            if (gesture.current !== current) return;
            current.active = true;
            latest.current.onStart();
            card.classList.add("is-reordering");
            setActive(true);
            frame = requestAnimationFrame(tick);
          }, 280);
          const pointerMove = (pointer: PointerEvent) => {
            if (pointer.pointerId !== pointerId) return;
            if (!current.active && Math.abs(pointer.clientY - current.y) > 10) {
              finishRef.current(true);
              return;
            }
            current.y = pointer.clientY;
            if (pointer.cancelable) pointer.preventDefault();
          };
          const pointerUp = (pointer: PointerEvent) => {
            if (pointer.pointerId === pointerId) finishRef.current(false);
          };
          const pointerCancel = (pointer: PointerEvent) => {
            if (pointer.pointerId === pointerId) finishRef.current(true);
          };
          const cancel = () => finishRef.current(true);
          const keyDown = (key: KeyboardEvent) => {
            if (key.key === "Escape") {
              key.preventDefault();
              key.stopPropagation();
              finishRef.current(true);
            }
          };
          document.addEventListener("pointermove", pointerMove, {
            passive: false,
          });
          document.addEventListener("pointerup", pointerUp);
          document.addEventListener("pointercancel", pointerCancel);
          document.addEventListener("keydown", keyDown, true);
          window.addEventListener("blur", cancel);
          current.cleanup = () => {
            clearTimeout(timer);
            cancelAnimationFrame(frame);
            document.removeEventListener("pointermove", pointerMove);
            document.removeEventListener("pointerup", pointerUp);
            document.removeEventListener("pointercancel", pointerCancel);
            document.removeEventListener("keydown", keyDown, true);
            window.removeEventListener("blur", cancel);
          };
        }}
        onKeyDown={(event) => {
          if (
            ![" ", "Enter", "ArrowUp", "ArrowDown", "Escape"].includes(
              event.key,
            )
          )
            return;
          event.preventDefault();
          event.stopPropagation();
          if (event.key === "Escape") return finish(true);
          if (gesture.current?.pointerId !== undefined) return;
          if (event.key === " " || event.key === "Enter") {
            if (event.repeat) return;
            if (gesture.current) return finish(false);
            const card = event.currentTarget.closest<HTMLElement>(
              "[data-reorder-card]",
            );
            if (!card) return;
            gesture.current = {
              card,
              y: 0,
              grabOffset: 0,
              offset: 0,
              active: true,
              moved: false,
              cleanup: () => {},
            };
            latest.current.onStart();
            card.classList.add("is-reordering");
            setActive(true);
          } else if (gesture.current) move(event.key === "ArrowUp" ? -1 : 1);
        }}
        onBlur={() => {
          // Moving a focused DOM node can briefly blur it before layout restores focus.
          window.setTimeout(() => {
            if (
              gesture.current?.pointerId === undefined &&
              document.activeElement !== button.current
            )
              finishRef.current(false);
          }, 0);
        }}
      >
        <Menu size={18} aria-hidden="true" />
      </button>
      {active && (
        <span className="sr-only" role="status">
          Moving {label}. Use up and down arrow keys to reorder, Space to drop,
          or Escape to cancel.
        </span>
      )}
    </>
  );
}
