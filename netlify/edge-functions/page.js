// Runs in front of the page (index.html) and the app manifest:
// - The page's title and link preview name this site's family (netlify/lib/families.mjs), with the
//   family's own preview image when it has one.
// - The app manifest (installing the site as an app) gets the family's name.
// - Every page is marked with the visitor's country (<html data-country="US">): the app starts in
//   English in the US until someone picks a language.
import { familyOfHost } from '../lib/families.mjs';

export default async (req, context) => {
  const url = new URL(req.url);
  const family = familyOfHost(url.hostname);
  const en = family.lang === 'en';
  const res = await context.next();
  if (url.pathname === '/site.webmanifest' && res.ok) {
    const m = await res.json();
    Object.assign(m, { name: en ? `${family.en} Family Tree` : `עץ משפחת ${family.he}`, short_name: en ? family.en : family.he, lang: family.lang, dir: en ? 'ltr' : 'rtl' });
    return new Response(JSON.stringify(m, null, 2), { headers: { 'content-type': 'application/manifest+json; charset=utf-8', 'cache-control': 'no-cache' } });
  }
  if (!(res.headers.get('content-type') ?? '').includes('text/html')) return res;
  // index.html names no family: put this one's name in the title and the link preview, and its
  // own preview image when it has one (families.mjs `og`, a file in public/).
  let html = await res.text();
  const attr = (v) => v.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  const set = (key, value) => { html = html.replace(new RegExp(`(<meta (?:property|name)="${key}" content=")[^"]*(")`), `$1${attr(value)}$2`); };
  const heName = `עץ משפחת ${family.he}`, enName = `${family.en} Family Tree`;
  const title = family.preview?.title ?? (en ? `${enName} · ${heName}` : `${heName} · ${enName}`);
  set('og:title', title);
  set('og:site_name', family.preview?.site ?? (en ? enName : heName));
  set('apple-mobile-web-app-title', family.preview?.site ?? (en ? family.en : family.he));
  if (family.preview?.description) { set('description', family.preview.description); set('og:description', family.preview.description); }
  html = html.replace(/<title>[^<]*<\/title>/, `<title>${attr(title)}</title>`);
  const og = [`<meta property="og:url" content="${url.origin}/" />`, `<meta property="og:locale" content="${en ? 'en_US' : 'he_IL'}" />`];
  if (family.og) og.push(`<meta property="og:image" content="${url.origin}/${family.og}" />`, '<meta name="twitter:card" content="summary_large_image" />');
  html = html.replace('</head>', `  ${og.join('\n  ')}\n</head>`);
  if (family.og) html = html.replace('<meta name="twitter:card" content="summary" />\n', '');
  if (en) html = html.replace('<html lang="he" dir="rtl">', '<html lang="en" dir="ltr">');
  const country = /^[A-Z]{2}$/.test(context.geo?.country?.code ?? '') ? context.geo.country.code : '';
  html = html.replace(/<html /, `<html data-country="${country}" `);
  const headers = new Headers(res.headers);
  headers.set('cache-control', 'no-cache');   // the page differs by country
  headers.delete('content-length');
  headers.delete('etag');
  return new Response(html, { status: res.status, headers });
};

export const config = { path: ['/', '/index.html', '/site.webmanifest'] };
