// Serve few.chat/assets/<id>.png from the `few-assets` R2 bucket.
//
// Why this exists: the avatar manifest (app/src/data/avatarManifest.json) and the
// avatar-browser config (app/src/config/profile.ts) point image URLs at
// //few.chat/assets/<id>.png. The app is a static export with no /assets/* handler,
// so without this function those requests fall through to the static 404 page and
// every avatar renders as a broken image. This Pages Function intercepts /assets/*
// (wrangler scopes it there automatically) and streams the object from R2.
//
// The `few_assets` binding is declared in the repo-root wrangler.toml.
// Objects are keyed as "<uuid>.png"; the manifest id is that key without ".png".

export async function onRequest(context) {
  const { request, env, params } = context;

  // Read-only asset endpoint.
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method Not Allowed', {
      status: 405,
      headers: { Allow: 'GET, HEAD' },
    });
  }

  // `[[path]]` is a catch-all: params.path is the segment(s) after /assets/.
  const key = Array.isArray(params.path) ? params.path.join('/') : params.path;

  // Reject empty keys and any path-traversal attempt.
  if (!key || key.includes('..') || key.startsWith('/')) {
    return new Response('Not Found', { status: 404 });
  }

  const object = await env.few_assets.get(key);

  // A real 404 (not the SPA page) so broken manifest entries stay diagnosable.
  if (!object) {
    return new Response('Not Found', { status: 404 });
  }

  const headers = new Headers();
  // Carry the object's stored Content-Type/metadata when present.
  object.writeHttpMetadata(headers);
  if (!headers.has('Content-Type')) {
    headers.set('Content-Type', 'image/png');
  }
  // Avatars are overwrite-by-id (the companion project can regenerate an avatar at
  // the same key), so a moderate TTL — not `immutable` — lets replacements surface
  // within a day instead of being pinned stale at the edge/browser for a year.
  headers.set('Cache-Control', 'public, max-age=86400');
  headers.set('ETag', object.httpEtag);

  return new Response(request.method === 'HEAD' ? null : object.body, { headers });
}
