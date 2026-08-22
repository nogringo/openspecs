/**
 * The longest side a picture is kept at. A profile picture is drawn small here
 * and large elsewhere, and nothing anywhere draws the four thousand pixels a
 * phone hands over.
 */
const MAX_SIDE = 1024;

/** What `canvas.toBlob` will actually encode. Anything else comes back out as JPEG. */
const ENCODABLE = new Set(["image/png", "image/jpeg", "image/webp"]);

const EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

export type Cleaned = {
  file: File;
  /** A first frame standing in for an animation, which re-encoding cannot keep. */
  stilled: boolean;
};

/**
 * A photograph carries where it was taken, when, and on what. A profile picture
 * carrying that is a home address published to four servers under a name nobody
 * can withdraw, and the person choosing the picture is not thinking about EXIF.
 *
 * So nothing is uploaded as it arrived. The image is decoded, drawn onto a
 * canvas and encoded again, and a canvas holds pixels and nothing else: every
 * tag the file had is gone because there is nowhere left to put it. Resizing is
 * the same operation, and free.
 *
 * A file that cannot be decoded is refused rather than sent through untouched.
 * That loses the occasional format this browser does not know, and the trade is
 * not close: the failure that matters is the one that publishes somebody's
 * location.
 */
export const cleanPicture = async (file: File): Promise<Cleaned> => {
  let bitmap: ImageBitmap;
  try {
    // Orientation is read out of EXIF and applied here, since it is about to be
    // thrown away with the rest of it: without this a portrait arrives sideways.
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new Error("This image could not be read here, so it was not sent.");
  }

  try {
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (context === null) throw new Error("This browser would not redraw the image.");
    context.drawImage(bitmap, 0, 0, width, height);

    const type = ENCODABLE.has(file.type) ? file.type : "image/jpeg";
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, type, 0.9);
    });
    if (blob === null) throw new Error("This browser would not re-encode the image.");

    return {
      file: new File([blob], `picture.${EXTENSIONS[type] ?? "jpg"}`, { type }),
      stilled: file.type === "image/gif",
    };
  } finally {
    bitmap.close();
  }
};
