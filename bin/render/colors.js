export const R = "\x1b[31m";
export const Y = "\x1b[33m";
export const G = "\x1b[32m";
export const C = "\x1b[36m";
export const B = "\x1b[34m";
export const M = "\x1b[35m";
export const X = "\x1b[90m";
export const D = "\x1b[2m";
export const Z = "\x1b[0m";

export function providerColor(providerTag) {
  if (providerTag === "CX") return C;
  if (providerTag === "GH") return G;
  return Z;
}

export function colorProviderTag(providerTag) {
  const color = providerColor(providerTag);
  return color === Z ? providerTag : `${color}${providerTag}${Z}`;
}
