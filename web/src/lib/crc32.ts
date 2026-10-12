const table = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
  return value >>> 0;
});

/** Feed chunks starting at -1; the final ZIP checksum is (~value) >>> 0. */
export function updateCrc32(value: number, bytes: Uint8Array): number {
  for (let index = 0; index < bytes.length; index++) {
    value = (value >>> 8) ^ table[(value ^ bytes[index]) & 0xff];
  }
  return value;
}
