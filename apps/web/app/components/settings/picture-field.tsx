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

const SAYING: Record<UploadStep, string> = {
  reading: "Reading the file",
  signing: "Waiting for your signature",
  sending: "Sending it",
  copying: "Copying it to your other servers",
  naming: "Naming the servers that hold it",
};

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

/**
 * What happened, in the order it matters. How many copies there are comes first,
 * because that is what decides whether this picture outlives one server, and one
 * copy is worth saying out loud rather than reporting as a success.
 */
const Told = ({ upload }: { upload: Upload }) => (
  <>
    <p className={upload.stored.length > 1 ? NOTE : WRONG}>
      {upload.stored.length > 1
        ? `Stored on ${plural(upload.stored.length, "server")}, so it outlives any one of them.`
        : `Stored on one server only. If ${new URL(upload.stored[0] ?? "https://x").host} goes, so does this picture.`}
      {upload.listed === "published" && " Your key now names them, so the copies can be found."}
      {upload.listed === "unheard" &&
        " No relay took the list of them, so nothing else can find the copies yet."}
    </p>
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

/**
 * A picture is a URL in the event, and pasting one is still the way to name an
 * image that is already somewhere. But almost nobody has a URL for the photo on
 * their phone, so a file dropped or chosen here is uploaded to a Blossom server
 * and the address it answers with is what goes in the field.
 *
 * The two are one control rather than two: whichever way the address arrived,
 * what is published is the same line of text, and it stays editable afterwards.
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
      <input
        id={id}
        className={FIELD}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="https://"
        inputMode="url"
        spellCheck={false}
      />

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
        className={`flex cursor-pointer items-center justify-center rounded-sm border border-dashed px-3 py-4 text-center font-mono text-[0.6875rem] uppercase tracking-[0.14em] ${
          over ? "border-ink text-ink" : "border-rule text-muted hover:border-muted hover:text-ink"
        } ${busy ? "cursor-wait" : ""}`}
      >
        <input
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
        {state.step === "working" ? SAYING[state.saying] : "Drop an image here, or choose a file"}
      </label>

      {state.step === "done" && <Told upload={state.upload} />}
      {state.step === "idle" && error === null && (
        <p className={NOTE}>An https address. It is loaded from wherever you name.</p>
      )}
      {error !== null && <p className={WRONG}>{error}</p>}
    </div>
  );
};
