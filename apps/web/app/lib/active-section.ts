import { useEffect, useState } from "react";

/** How far down the window a heading has to come before its section counts as the one being read. */
const READING_LINE = 0.3;

/**
 * The section the reader is in: the last of `ids`, given in page order, whose
 * element has risen past the reading line, or the last one present once the
 * page cannot scroll further, since a short closing section never reaches the
 * line. Null above the first, and on the server, so the first paint marks nothing.
 */
export const useActiveSection = (ids: string[]): string | null => {
  const [active, setActive] = useState<string | null>(null);
  const key = ids.join(" ");

  useEffect(() => {
    const listed = key === "" ? [] : key.split(" ");
    let frame = 0;

    const measure = () => {
      frame = 0;
      const present = listed
        .map((id) => document.getElementById(id))
        .filter((element) => element !== null);
      const atEnd =
        window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;
      const line = window.innerHeight * READING_LINE;
      const passed = present.filter((element) => element.getBoundingClientRect().top <= line);
      const current = atEnd && passed.length > 0 ? present.at(-1) : passed.at(-1);
      setActive(current?.id ?? null);
    };
    const schedule = () => {
      if (frame === 0) frame = requestAnimationFrame(measure);
    };

    measure();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, [key]);

  return active;
};
