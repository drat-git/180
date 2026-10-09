export async function normalizePhoto(blob: Blob): Promise<Blob> {
  let source = blob;
  if (/hei[cf]/i.test(blob.type)) {
    const { default: convert } = await import("heic2any");
    const result = await convert({ blob, toType: "image/jpeg", quality: 0.9 });
    source = Array.isArray(result) ? result[0] : result;
  }
  const url = URL.createObjectURL(source);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const scale = Math.min(
      1,
      2560 / Math.max(image.naturalWidth, image.naturalHeight),
    );
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(image.naturalWidth * scale);
    canvas.height = Math.round(image.naturalHeight * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not prepare the photo.");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) =>
          b ? resolve(b) : reject(new Error("Could not prepare the photo.")),
        "image/jpeg",
        0.9,
      ),
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}
