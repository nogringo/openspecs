import { useState } from "react";
import { type Upload, type UploadStep, uploadPicture } from "~/lib/blossom";

type State =
  | { step: "idle" }
  | { step: "working"; saying: UploadStep }
  | { step: "done"; upload: Upload };

const FIELD =
  "w-full rounded-sm border border-rule bg-paper px-3 py-2 font-mono text-xs text-ink placeholder:text-muted";

const NOTE = "font-serif text-[0.8125rem] leading-snug text-muted";

const WRONG = "font-serif text-[0.8125rem] leading-snug text-signal-closed";

const CHROME = "font-mono text-[0.6875rem] uppercase tracking-[0.14em] text-muted hover:text-ink";

const SAYING: Record<UploadStep, string> = {
  cleaning: "Redrawing it",
  signing: "Waiting for your signature",
  sending: "Sending it",
  copying: "Copying it to your other servers",
  naming: "Naming the servers that hold it",
};

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

/**
 * Nothing at all when an upload went the way uploads go. The picture is on
 * screen above, which is the whole of what somebody choosing one wanted to know,
 * and how many bytes it weighs or how many servers hold it are answers to
 * questions nobody asked.
 *
 * What is left is what a reader would be wrong not to know: a picture on one
 * server, an animation that stopped moving, copies nothing can find. Those are
 * worth a line, and they are why this is not simply silent.
 */
const Trouble = ({ upload }: { upload: Upload }) => {
  const alone = upload.stored.length < 2;
  if (!alone && !upload.stilled && upload.listed !== "unheard" && upload.refused.length === 0) {
    return null;
  }

  return (
    <>
      {alone && (
        <p className={WRONG}>
          This is on one server only. If {new URL(upload.stored[0] ?? "https://x").host} goes, so
          does your picture.
        </p>
      )}
      {upload.listed === "unheard" && (
        <p className={WRONG}>
          No relay took the list of servers holding it, so nothing else can find the copies yet.
        </p>
      )}
      {upload.stilled && <p className={NOTE}>A moving image is sent as its first frame.</p>}
      {upload.refused.length > 0 && (
        <details className="font-mono text-[0.6875rem] uppercase tracking-[0.14em] text-muted">
          <summary className="cursor-pointer hover:text-ink">
            {plural(upload.refused.length, "server")} refused
          </summary>
          <ul className="mt-2 space-y-1 normal-case tracking-normal">
            {upload.refused.map((refusal) => (
              <li key={refusal}>{refusal}</li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
};

/**
 * A picture is a URL in the event, so an address typed by hand has to stay
 * possible: an image already somewhere is named rather than uploaded again. But
 * almost nobody has a URL for the photo on their phone, and asking everybody to
 * find one so that the few who have one save a click is the wrong way round. The
 * file comes first and the address folds away behind it.
 *
 * Nothing here says that a picture is stripped of where and when it was taken.
 * `cleanPicture` does it and says why; announcing it would raise a worry in a
 * reader who was not carrying one, and the answer to a worry nobody has is not a
 * sentence.
 */
export const PictureField = ({
  id,
  me,
  value,
  onChange,
}: {
  id: string;
  me: string;
  value: string;
  onChange: (value: string) => void;
}) => {
  const [state, setState] = useState<State>({ step: "idle" });
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState(false);

  const busy = state.step === "working";

  const take = async (file: File | undefined) => {
    if (file === undefined || busy) return;
    setError(null);
    try {
      const upload = await uploadPicture(
        me,
        file,
        (saying) => setState({ step: "working", saying }),
        // The address as soon as it is good for anything, so the rest of the
        // form can be filled in while the copies are still being made.
        (blob) => onChange(blob.url),
      );
      setState({ step: "done", upload });
    } catch (reason) {
      setState({ step: "idle" });
      setError(reason instanceof Error ? reason.message : "That did not work.");
    }
  };

  return (
    <div className="space-y-2">
      {/* A label rather than a button, so the file input it opens is the thing
          the pointer and the keyboard both land on, and the drop target is the
          same rectangle either way. */}
      <label
        onDragOver={(event) => {
          event.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(event) => {
          event.preventDefault();
          setOver(false);
          void take(event.dataTransfer.files[0]);
        }}
        className={`flex cursor-pointer items-center justify-center rounded-sm border border-dashed px-3 py-5 text-center font-mono text-[0.6875rem] uppercase tracking-[0.14em] ${
          over ? "border-ink text-ink" : "border-rule text-muted hover:border-muted hover:text-ink"
        } ${busy ? "cursor-wait" : ""}`}
      >
        <input
          id={id}
          type="file"
          accept="image/*"
          className="sr-only"
          disabled={busy}
          onChange={(event) => {
            void take(event.target.files?.[0]);
            // Cleared, or choosing the same file twice in a row fires nothing.
            event.target.value = "";
          }}
        />
        {state.step === "working"
          ? SAYING[state.saying]
          : value === ""
            ? "Drop an image here, or choose a file"
            : "Drop another, or choose one"}
      </label>

      {state.step === "done" && <Trouble upload={state.upload} />}
      {error !== null && <p className={WRONG}>{error}</p>}

      <div className="flex flex-wrap items-center gap-4">
        {value !== "" && (
          <button
            type="button"
            className={CHROME}
            onClick={() => {
              onChange("");
              setState({ step: "idle" });
              setError(null);
            }}
          >
            Remove
          </button>
        )}
        {/* Folded, because naming an address is the uncommon way in and the
            common one is above it. Open it and the address is editable, which is
            also how a picture uploaded a moment ago can be read off. */}
        <details className="min-w-full">
          <summary className={`cursor-pointer ${CHROME}`}>Use an address instead</summary>
          <input
            className={`${FIELD} mt-2`}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            placeholder="https://"
            inputMode="url"
            spellCheck={false}
            aria-label="The address of a picture"
          />
        </details>
      </div>
    </div>
  );
};
