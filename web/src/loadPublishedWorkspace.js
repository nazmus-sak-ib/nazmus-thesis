// A new visitor starts from the committed workspace; older exports still work.
export async function loadPublishedWorkspace(base, fetcher = fetch) {
  for (const filename of ['workspace.json', 'layout.json']) {
    const response = await fetcher(base + filename, { cache: 'no-store' });
    if (response.status === 404) continue;
    if (!response.ok) throw Error(`Could not read ${filename} (${response.status}).`);
    // Vite/static SPA hosts can answer a missing JSON URL with index.html.
    if(response.headers?.get('content-type')?.includes('text/html')) continue;
    return response.json();
  }
  return {};
}
