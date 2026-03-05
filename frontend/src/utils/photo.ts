export const APP_BUILD_ID =
  typeof __APP_BUILD_ID__ === "string" && __APP_BUILD_ID__.trim().length > 0
    ? __APP_BUILD_ID__.trim()
    : "dev";

const CACHE_PARAM = "v";
const NON_CACHEABLE_SCHEMES = /^(data:|blob:)/i;

const splitHash = (value: string): [string, string] => {
  const hashIndex = value.indexOf("#");
  if (hashIndex === -1) {
    return [value, ""];
  }
  return [value.slice(0, hashIndex), value.slice(hashIndex + 1)];
};

const splitQuery = (value: string): [string, string] => {
  const queryIndex = value.indexOf("?");
  if (queryIndex === -1) {
    return [value, ""];
  }
  return [value.slice(0, queryIndex), value.slice(queryIndex + 1)];
};

export const appendCacheBuster = (url: string, token = APP_BUILD_ID): string => {
  const trimmed = url.trim();
  if (!trimmed || NON_CACHEABLE_SCHEMES.test(trimmed) || !token) {
    return trimmed;
  }

  const [withoutHash, hash] = splitHash(trimmed);
  const [path, query] = splitQuery(withoutHash);
  const params = new URLSearchParams(query);
  params.set(CACHE_PARAM, token);
  const nextQuery = params.toString();

  return `${path}${nextQuery ? `?${nextQuery}` : ""}${hash ? `#${hash}` : ""}`;
};

export const avatarFallback = (name: string) =>
  `https://ui-avatars.com/api/?name=${encodeURIComponent(name).replace(/%20/g, "+")}&background=2C5F7C&color=fff`;

export const resolveEmployeePhoto = (
  photo: string | undefined,
  name: string,
  cacheScope?: string
): string => {
  const source = photo?.trim() || avatarFallback(name);
  const scope = cacheScope?.trim();
  const token = scope ? `${APP_BUILD_ID}-${scope}` : APP_BUILD_ID;
  return appendCacheBuster(source, token);
};
