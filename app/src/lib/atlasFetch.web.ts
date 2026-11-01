/** Browsers supply their own User-Agent and origin/referrer. */
export const atlasFetch: typeof fetch = (input, init) => fetch(input, init);
