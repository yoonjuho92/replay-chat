import "server-only";

/**
 * 브라우저가 알려주는 file.type 은 믿을 수 없다. 아이폰에서 올린 사진이 png 로
 * 둔갑해 들어오면 그림 모델이 "Invalid image file or mode" 로 거절한다.
 * 그래서 파일 앞머리 바이트를 직접 보고 형식을 정한다.
 */
export type ImageKind = { mime: string; ext: string };

const PNG: ImageKind = { mime: "image/png", ext: "png" };
const JPEG: ImageKind = { mime: "image/jpeg", ext: "jpg" };
const WEBP: ImageKind = { mime: "image/webp", ext: "webp" };
const GIF: ImageKind = { mime: "image/gif", ext: "gif" };
const HEIC: ImageKind = { mime: "image/heic", ext: "heic" };
const AVIF: ImageKind = { mime: "image/avif", ext: "avif" };

/** gpt-image 계열이 참조 사진으로 받아주는 형식. gif, heic, avif 는 못 읽는다. */
const DRAWABLE = new Set([PNG.mime, JPEG.mime, WEBP.mime]);

export function sniffImage(bytes: Buffer): ImageKind | null {
  if (bytes.length < 12) return null;

  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return PNG;
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return JPEG;
  if (bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") {
    return WEBP;
  }
  if (bytes.toString("ascii", 0, 4) === "GIF8") return GIF;

  // heic/heif/avif 는 ISO-BMFF 라 앞 4바이트가 박스 길이고 그 다음이 ftyp 다.
  // 아이폰과, "고효율 이미지" 를 켠 갤럭시 카메라가 이 형식으로 사진을 저장한다.
  if (bytes.toString("ascii", 4, 8) === "ftyp") {
    const brand = bytes.toString("ascii", 8, 12);
    if (brand === "avif" || brand === "avis") return AVIF;
    if (["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1"].includes(brand)) {
      return HEIC;
    }
  }

  return null;
}

export function isDrawable(mime: string) {
  return DRAWABLE.has(mime);
}
