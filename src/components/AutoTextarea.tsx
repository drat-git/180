import { useLayoutEffect, useRef, type TextareaHTMLAttributes } from "react";

// Keep empty notes quiet while expanding for saved text and narrow layouts.
export function AutoTextarea(
  props: TextareaHTMLAttributes<HTMLTextAreaElement>,
) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const input = ref.current;
    if (!input) return;
    const fit = () => {
      if (!input.offsetWidth) return;
      input.style.height = "auto";
      const style = getComputedStyle(input);
      const borders =
        parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
      input.style.height = `${input.scrollHeight + borders}px`;
    };
    fit();
    let width = input.offsetWidth;
    const observer = new ResizeObserver(() => {
      if (width === input.offsetWidth) return;
      width = input.offsetWidth;
      fit();
    });
    observer.observe(input);
    return () => observer.disconnect();
  }, [props.value]);
  return <textarea {...props} ref={ref} />;
}
