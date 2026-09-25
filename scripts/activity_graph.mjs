#!/usr/bin/env node
// Draw an animated contribution graph (last 31 days) for a GitHub profile README.
//
// Runs inside GitHub Actions (see .github/workflows/activity.yml).
// Needs GITHUB_TOKEN and GH_USER in the environment. No packages needed.

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { fx, num } from "./snake_grid.mjs";

const OUT = process.env.OUT || "assets/activity.svg";
const DAYS = 31;
const W = 900, H = 300;
const PAD_L = 56, PAD_R = 28, PAD_T = 70, PAD_B = 46;
const MONO = "ui-monospace,SFMono-Regular,Menlo,Consolas,'Liberation Mono',monospace";
const LINE = "#BF91F3", POINT = "#38BDAE", AREA = "#BF91F3", TITLE = "#70A5FD";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Like Python's "{:g}" for the small axis numbers used here (3.0 -> "3", 1.5 -> "1.5").
const g = (x) => String(Number(x.toPrecision(6)));
const pad = (n) => String(n).padStart(2, "0");
const iso = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}Z`;

export async function fetchDays(user, token) {
  const now = new Date();
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59));
  const frm = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - (DAYS - 1), 0, 0, 0));
  const query = `query($u:String!,$f:DateTime!,$t:DateTime!){user(login:$u){
      contributionsCollection(from:$f,to:$t){contributionCalendar{weeks{contributionDays{date contributionCount}}}}}}`;
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { Authorization: `bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables: { u: user, f: iso(frm), t: iso(to) } }),
  });
  if (!res.ok) throw new Error(`GitHub API returned ${res.status}`);
  const weeks = (await res.json()).data.user.contributionsCollection.contributionCalendar.weeks;
  const days = weeks.flatMap((w) => w.contributionDays.map((d) => [d.date, d.contributionCount]));
  return days.slice(-DAYS);
}

export function render(days, note = "") {
  const counts = days.map(([, c]) => c);
  const total = counts.reduce((a, b) => a + b, 0);
  let top = Math.max(Math.max(...counts), 4);
  top = top + (((-top % 4) + 4) % 4); // round up so the grid divides evenly
  const iw = W - PAD_L - PAD_R, ih = H - PAD_T - PAD_B;
  const step = iw / (days.length - 1);
  const xy = (i, c) => [PAD_L + i * step, PAD_T + ih - (c / top) * ih];

  const pts = counts.map((c, i) => xy(i, c));
  const line = "M" + pts.map(([x, y]) => `${fx(x, 1)} ${fx(y, 1)}`).join(" L");
  const area = line + ` L${fx(pts[pts.length - 1][0], 1)} ${PAD_T + ih} L${fx(pts[0][0], 1)} ${PAD_T + ih} Z`;
  let length = 0;
  for (let i = 1; i < pts.length; i++) {
    length += ((pts[i][0] - pts[i - 1][0]) ** 2 + (pts[i][1] - pts[i - 1][1]) ** 2) ** 0.5;
  }
  length += 10;

  let grid = "";
  for (let k = 0; k < 5; k++) {
    const v = (top * k) / 4;
    const y = PAD_T + ih - (v / top) * ih;
    grid += `<line x1="${PAD_L}" x2="${W - PAD_R}" y1="${fx(y, 1)}" y2="${fx(y, 1)}" stroke="#21262d"/>` +
      `<text x="${PAD_L - 10}" y="${fx(y + 3.5, 1)}" text-anchor="end" font-size="10" fill="#6e7681">${g(v)}</text>`;
  }
  days.forEach(([d], i) => {
    if (i % 5 === 0 || i === days.length - 1) {
      const x = PAD_L + i * step;
      const label = `${d.slice(8, 10)} ${MONTHS[Number(d.slice(5, 7)) - 1]}`;
      grid += `<text x="${fx(x, 1)}" y="${H - PAD_B + 20}" text-anchor="middle" font-size="10" fill="#6e7681">${label}</text>`;
    }
  });

  const T = 9.0;
  const drawEnd = (3.2 / T) * 100;
  let dots = "", cssDots = "";
  pts.forEach(([x, y], i) => {
    const at = ((0.2 + (3.0 * i) / (pts.length - 1)) / T) * 100;
    cssDots += `@keyframes p${i}{0%,${fx(at, 2)}%{transform:scale(0)}${fx(at + 1.5, 2)}%,94%{transform:scale(1)}100%{transform:scale(0)}}` +
      `.p${i}{animation:p${i} ${num(T)}s ease-out infinite}`;
    dots += `<circle class="pt p${i}" cx="${fx(x, 1)}" cy="${fx(y, 1)}" r="3.4" fill="${POINT}"/>`;
  });
  const [lx, ly] = pts[pts.length - 1];
  let bestI = 0;
  counts.forEach((c, i) => { if (c > counts[bestI]) bestI = i; });
  const [bx, by] = pts[bestI];

  const css = `text{font-family:${MONO}}
@keyframes draw{0%{stroke-dashoffset:${fx(length, 0)}}${fx(drawEnd, 2)}%,94%{stroke-dashoffset:0}100%{stroke-dashoffset:${fx(length, 0)}}}
.line{stroke-dasharray:${fx(length, 0)};animation:draw ${num(T)}s cubic-bezier(.5,0,.3,1) infinite}
@keyframes area{0%,10%{opacity:0}${fx(drawEnd, 2)}%,94%{opacity:1}100%{opacity:0}}.area{animation:area ${num(T)}s ease-out infinite}
.pt{transform-box:fill-box;transform-origin:center}
${cssDots}
@keyframes ring{0%{transform:scale(1);opacity:.9}100%{transform:scale(3.2);opacity:0}}
.ring{transform-box:fill-box;transform-origin:center;animation:ring 1.6s ease-out infinite}
@keyframes tag{0%,${fx(drawEnd, 2)}%{opacity:0}${fx(drawEnd + 4, 2)}%,94%{opacity:1}100%{opacity:0}}.tag{animation:tag ${num(T)}s ease-out infinite}
@keyframes scan{0%{transform:translateX(0);opacity:0}5%{opacity:.9}${fx(drawEnd, 2)}%{transform:translateX(${iw}px);opacity:.9}${fx(drawEnd + 2, 2)}%,100%{opacity:0;transform:translateX(${iw}px)}}
.scan{animation:scan ${num(T)}s cubic-bezier(.5,0,.3,1) infinite}
@media (prefers-reduced-motion:reduce){*{animation:none!important}}`;

  const noteSvg = note ? `<text x="${W - PAD_R}" y="${H - 10}" text-anchor="end" font-size="9.5" fill="#6e7681">${note}</text>` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Contribution graph: ${total} contributions in the last ${DAYS} days">
<style>${css}</style>
<defs><linearGradient id="ag" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${AREA}" stop-opacity=".35"/><stop offset="1" stop-color="${AREA}" stop-opacity="0"/></linearGradient>
<linearGradient id="sg" x1="0" x2="1"><stop offset="0" stop-color="${TITLE}" stop-opacity="0"/><stop offset="1" stop-color="${TITLE}" stop-opacity=".5"/></linearGradient></defs>
<rect x=".5" y=".5" width="${W - 1}" height="${H - 1}" rx="12" fill="#0d1117" stroke="#30363d"/>
<text x="${PAD_L}" y="34" font-size="15" font-weight="700" fill="${TITLE}">contributions · last ${DAYS} days</text>
<text x="${W - PAD_R}" y="34" text-anchor="end" font-size="12" fill="#c9d1d9"><tspan fill="${POINT}" font-weight="700">${total}</tspan> total  ·  best day <tspan fill="${LINE}" font-weight="700">${counts[bestI]}</tspan></text>
${grid}
<path class="area" d="${area}" fill="url(#ag)"/>
<path class="line" d="${line}" fill="none" stroke="${LINE}" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"/>
<rect class="scan" x="${PAD_L - 40}" y="${PAD_T}" width="40" height="${ih}" fill="url(#sg)"/>
${dots}
<circle cx="${fx(lx, 1)}" cy="${fx(ly, 1)}" r="4" fill="none" stroke="${POINT}" class="ring"/>
<g class="tag"><rect x="${fx(bx - 22, 1)}" y="${fx(by - 30, 1)}" width="44" height="18" rx="4" fill="#1d1530" stroke="${LINE}" stroke-opacity=".6"/>
<text x="${fx(bx, 1)}" y="${fx(by - 17.5, 1)}" text-anchor="middle" font-size="10" fill="#e6edf3">${counts[bestI]}</text></g>
${noteSvg}
</svg>`;
}

export function placeholder() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="120" viewBox="0 0 ${W} 120" role="img" aria-label="Contribution graph is being generated">
<style>text{font-family:${MONO}}@keyframes spin{to{transform:rotate(360deg)}}.s{transform-origin:40px 60px;animation:spin 1s linear infinite}</style>
<rect x=".5" y=".5" width="${W - 1}" height="119" rx="12" fill="#0d1117" stroke="#30363d"/>
<circle class="s" cx="40" cy="60" r="12" fill="none" stroke="${LINE}" stroke-width="3" stroke-dasharray="40 40"/>
<text x="68" y="56" font-size="13" fill="#c9d1d9">Contribution graph is being generated…</text>
<text x="68" y="76" font-size="11" fill="#6e7681">Actions → "Update activity graph" → Run workflow</text>
</svg>`;
}

// Made-up data for trying the look without a token: node activity_graph.mjs --sample
function sampleDays() {
  let seed = 4;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const choices = [0, 1, 2, 3, 4, 5, 6, 8, 9, 12];
  const today = new Date();
  const days = [];
  for (let i = DAYS - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - i));
    days.push([d.toISOString().slice(0, 10), choices[Math.floor(rand() * choices.length)]]);
  }
  return days;
}

async function main() {
  mkdirSync(dirname(OUT) || ".", { recursive: true });
  let svg;
  if (process.argv.includes("--placeholder")) svg = placeholder();
  else if (process.argv.includes("--sample")) svg = render(sampleDays(), "sample data · preview only");
  else svg = render(await fetchDays(process.env.GH_USER, process.env.GITHUB_TOKEN));
  writeFileSync(OUT, svg);
  console.log("wrote", OUT);
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().catch((err) => { console.error(err); process.exit(1); });
}
