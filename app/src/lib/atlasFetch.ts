/** Native downloads identify the app to the vector tile provider. */
export const atlasFetch: typeof fetch = (input, init) => fetch(input, {
  ...init,
  headers: { ...init?.headers, 'User-Agent': 'Musette/0.1 (+https://github.com/enavarro222/musette)' },
});
