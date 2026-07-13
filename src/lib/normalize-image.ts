/**
 * 올리기 전에 브라우저에서 사진을 png/jpg/webp 로 맞춰 준다.
 *
 * 아이폰과, 카메라 설정에서 "고효율 이미지" 를 켠 갤럭시는 사진을 heic/heif 로 저장한다.
 * 그림 모델은 그 형식을 못 읽는다. 브라우저가 열 수 있는 사진이면 여기서 jpg 로 바꿔
 * 올리고, 못 열면 원본 그대로 올려 서버가 사람이 읽을 수 있는 말로 거절하게 둔다.
 * 큰 사진을 줄여 주기도 해서 휴대폰 데이터로 올릴 때 훨씬 빠르다.
 */
const MAX_SIDE = 2048;
const AS_IS = ["image/png", "image/jpeg", "image/webp"];

export async function normalizeImage(file: File): Promise<File> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return file; // 브라우저가 못 여는 형식. 서버가 걸러낸다.
  }

  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));

  if (AS_IS.includes(file.type) && scale === 1) {
    bitmap.close();
    return file;
  }

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    return file;
  }

  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", 0.9),
  );
  if (!blob) return file;

  const name = file.name.replace(/\.[^.]+$/, "") || "photo";
  return new File([blob], `${name}.jpg`, { type: "image/jpeg" });
}
