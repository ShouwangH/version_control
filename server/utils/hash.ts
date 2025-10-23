import { createHash } from "crypto";

export function sha256(data: Buffer | string) {
  return createHash("sha256").update(data).digest("hex");
}
