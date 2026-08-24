/**
 * What the header's own controls are drawn with. Shared rather than copied,
 * because two panels hanging off the same line that drift apart by a pixel read
 * as two different pieces of software.
 */
export const CHROME =
  "rounded-sm border border-rule px-2 py-1 font-mono text-[0.6875rem] uppercase tracking-[0.14em] text-muted hover:border-muted hover:text-ink";

/**
 * The header is set in wide-tracked capitals, and everything inside it inherits
 * that. A panel is not chrome, it is a place to read a sentence and a key, so it
 * puts the type back to normal and lets what wants the chrome ask for it.
 */
export const Panel = ({
  children,
  width = "w-[min(20rem,calc(100vw-2rem))]",
}: {
  children: React.ReactNode;
  /**
   * Wide enough for what it holds. The default suits a sentence and a key; a
   * list of rows wants more, since every pixel it lacks is taken out of the
   * sentence in each of them at once.
   */
  width?: string;
}) => (
  <div
    className={`absolute right-0 top-full z-10 mt-2 ${width} rounded-sm border border-rule bg-paper p-4 text-sm normal-case tracking-normal shadow-sm`}
  >
    {children}
  </div>
);
