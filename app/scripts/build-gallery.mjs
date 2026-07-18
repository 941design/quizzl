/**
 * Renders `manifest.json` (written by the capture run) into a single, self-
 * contained `index.html` you can open straight off disk — no server needed.
 *
 * The gallery groups screens by user flow, shows each screen's description and
 * the product invariants it is evidence for, and offers a viewport toggle
 * (Mobile / Tablet / Laptop / Desktop) that swaps every screenshot at once.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.resolve(__dirname, "..");
const OUT_DIR = process.env.SCREENSHOTS_OUT
  ? path.resolve(process.env.SCREENSHOTS_OUT)
  : path.join(APP_DIR, "screenshots-out");

const manifestPath = path.join(OUT_DIR, "manifest.json");
if (!fs.existsSync(manifestPath)) {
  console.error(`[gallery] No manifest at ${manifestPath} — did the capture run?`);
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

const esc = (s) =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const viewports = manifest.viewports;
const defaultVp = viewports[0]?.id ?? "mobile";

function shotFor(screen, vpId) {
  return screen.capture.shots.find((s) => s.viewport === vpId) ?? null;
}

function screenCard(screen) {
  const invariants = screen.invariants
    .map((inv) => `<li>${esc(inv)}</li>`)
    .join("");

  const populated = screen.populated
    ? `<span class="badge badge--pop" title="Driven through a real multi-user setup">populated</span>`
    : "";

  let media;
  if (screen.capture.status !== "ok" || screen.capture.shots.length === 0) {
    media = `<div class="media-failed">
      <strong>Not captured.</strong>
      <span>${esc(screen.capture.error || "unknown error")}</span>
    </div>`;
  } else {
    media = viewports
      .map((vp) => {
        const shot = shotFor(screen, vp.id);
        if (!shot) return "";
        const rel = `shots/${shot.file}`;
        return `<figure class="shot shot--${vp.id}" data-vp="${vp.id}">
          <a href="${esc(rel)}" target="_blank" rel="noopener">
            <img loading="lazy" src="${esc(rel)}" alt="${esc(screen.title)} — ${esc(vp.label)}"
                 style="max-width:${Math.min(vp.width, 520)}px" />
          </a>
          <figcaption>${vp.width} × ${vp.height} · ${esc(vp.label)}</figcaption>
        </figure>`;
      })
      .join("");
  }

  return `<article class="card" id="screen-${esc(screen.id)}">
    <div class="card__body">
      <h3>${esc(screen.title)} ${populated}</h3>
      <p class="desc">${esc(screen.description)}</p>
      <div class="invariants">
        <span class="invariants__label">Invariants</span>
        <ul>${invariants}</ul>
      </div>
    </div>
    <div class="card__media">${media}</div>
  </article>`;
}

function flowSection(flow) {
  return `<section class="flow" id="flow-${esc(flow.id)}">
    <header class="flow__header">
      <h2>${esc(flow.title)}</h2>
      <p>${esc(flow.summary)}</p>
    </header>
    ${flow.screens.map(screenCard).join("\n")}
  </section>`;
}

const navItems = manifest.flows
  .map(
    (f) =>
      `<li><a href="#flow-${esc(f.id)}">${esc(f.title)}</a>
        <ul>${f.screens
          .map((s) => `<li><a href="#screen-${esc(s.id)}">${esc(s.title)}</a></li>`)
          .join("")}</ul>
      </li>`,
  )
  .join("");

const vpButtons = viewports
  .map(
    (vp) =>
      `<button class="vp-btn${vp.id === defaultVp ? " is-active" : ""}" data-vp="${vp.id}">
        ${esc(vp.label)}<small>${vp.width}px</small>
      </button>`,
  )
  .join("");

const html = `<!doctype html>
<html lang="en" data-viewport="${defaultVp}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>few.chat — UI documentation</title>
<style>
  :root {
    --bg: #0f1115; --panel: #161a21; --panel-2: #1d222b; --border: #2a313d;
    --text: #e6e9ef; --muted: #9aa4b2; --accent: #7cc5ff; --pop: #b98cff;
    --ok: #57d9a3; --fail: #ff6b6b; --shadow: 0 8px 30px rgba(0,0,0,.35);
  }
  @media (prefers-color-scheme: light) {
    :root {
      --bg: #f5f6f8; --panel: #ffffff; --panel-2: #f0f2f5; --border: #dfe3ea;
      --text: #1b1f27; --muted: #5a6473; --accent: #1d74d6; --pop: #7a4fd6;
      --ok: #128a5a; --fail: #c0392b; --shadow: 0 6px 24px rgba(20,30,50,.08);
    }
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--text);
    font: 15px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
  a { color: var(--accent); text-decoration: none; }
  a:hover { text-decoration: underline; }

  .topbar { position: sticky; top: 0; z-index: 20; display: flex; flex-wrap: wrap;
    align-items: center; gap: 16px; padding: 14px 24px; background: var(--panel);
    border-bottom: 1px solid var(--border); }
  .topbar h1 { font-size: 16px; margin: 0; font-weight: 650; }
  .topbar .meta { color: var(--muted); font-size: 12.5px; }
  .totals { margin-left: auto; font-size: 12.5px; color: var(--muted); }
  .totals b.ok { color: var(--ok); } .totals b.fail { color: var(--fail); }

  .vp-toggle { display: inline-flex; gap: 4px; padding: 4px; background: var(--panel-2);
    border: 1px solid var(--border); border-radius: 10px; }
  .vp-btn { display: flex; flex-direction: column; align-items: center; line-height: 1.1;
    border: 0; background: transparent; color: var(--muted); padding: 6px 12px;
    border-radius: 7px; cursor: pointer; font-size: 13px; font-weight: 600; }
  .vp-btn small { font-weight: 400; font-size: 10.5px; opacity: .8; }
  .vp-btn.is-active { background: var(--accent); color: #fff; }

  .layout { display: grid; grid-template-columns: 250px 1fr; align-items: start; }
  nav.side { position: sticky; top: 61px; align-self: start; height: calc(100vh - 61px);
    overflow: auto; padding: 18px 14px; border-right: 1px solid var(--border);
    background: var(--panel); }
  nav.side > ul { list-style: none; margin: 0; padding: 0; }
  nav.side > ul > li { margin-bottom: 10px; }
  nav.side > ul > li > a { font-weight: 650; }
  nav.side ul ul { list-style: none; margin: 4px 0 0; padding-left: 12px;
    border-left: 1px solid var(--border); }
  nav.side ul ul a { color: var(--muted); font-size: 13px; }

  main { padding: 26px 32px 120px; max-width: 1200px; }
  .flow { margin-bottom: 48px; }
  .flow__header { margin-bottom: 18px; }
  .flow__header h2 { margin: 0 0 4px; font-size: 22px; }
  .flow__header p { margin: 0; color: var(--muted); max-width: 720px; }

  .card { display: grid; grid-template-columns: 320px 1fr; gap: 24px;
    background: var(--panel); border: 1px solid var(--border); border-radius: 14px;
    padding: 20px; margin-bottom: 20px; box-shadow: var(--shadow); }
  .card__body h3 { margin: 0 0 8px; font-size: 17px; display: flex; align-items: center; gap: 8px; }
  .card .desc { color: var(--muted); margin: 0 0 14px; }
  .invariants__label { display: inline-block; font-size: 11px; letter-spacing: .06em;
    text-transform: uppercase; color: var(--muted); margin-bottom: 6px; }
  .invariants ul { margin: 0; padding-left: 18px; }
  .invariants li { margin-bottom: 6px; font-size: 13.5px; }

  .badge { font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: .05em;
    padding: 2px 7px; border-radius: 999px; }
  .badge--pop { color: #fff; background: var(--pop); }

  .card__media { display: flex; flex-wrap: wrap; gap: 16px; align-items: flex-start; }
  .shot { margin: 0; }
  .shot img { display: block; width: 100%; height: auto; border: 1px solid var(--border);
    border-radius: 10px; background: #fff; box-shadow: var(--shadow); }
  .shot figcaption { margin-top: 6px; font-size: 11.5px; color: var(--muted); text-align: center; }
  /* Only the active viewport's shot is shown. */
  .shot { display: none; }
  html[data-viewport="mobile"] .shot--mobile,
  html[data-viewport="tablet"] .shot--tablet,
  html[data-viewport="laptop"] .shot--laptop,
  html[data-viewport="desktop"] .shot--desktop { display: block; }

  .media-failed { padding: 20px; border: 1px dashed var(--fail); border-radius: 10px;
    color: var(--fail); display: flex; flex-direction: column; gap: 4px; font-size: 13px; max-width: 420px; }
  .media-failed span { color: var(--muted); word-break: break-word; }

  @media (max-width: 900px) {
    .layout { grid-template-columns: 1fr; }
    nav.side { display: none; }
    .card { grid-template-columns: 1fr; }
    main { padding: 20px 16px 80px; }
  }
</style>
</head>
<body>
  <div class="topbar">
    <h1>few.chat — UI documentation</h1>
    <span class="meta">${esc(manifest.generatedAt)} · build ${esc(manifest.buildVersion)}</span>
    <div class="vp-toggle">${vpButtons}</div>
    <span class="totals"><b class="ok">${manifest.totals.ok}</b> captured · <b class="fail">${manifest.totals.failed}</b> failed</span>
  </div>
  <div class="layout">
    <nav class="side"><ul>${navItems}</ul></nav>
    <main>${manifest.flows.map(flowSection).join("\n")}</main>
  </div>
  <script>
    const root = document.documentElement;
    document.querySelectorAll(".vp-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".vp-btn").forEach((b) => b.classList.remove("is-active"));
        btn.classList.add("is-active");
        root.setAttribute("data-viewport", btn.dataset.vp);
      });
    });
  </script>
</body>
</html>
`;

const outFile = path.join(OUT_DIR, "index.html");
fs.writeFileSync(outFile, html);
console.log(`[gallery] wrote ${outFile}`);
console.log(`[gallery] open it with:  file://${outFile}`);
