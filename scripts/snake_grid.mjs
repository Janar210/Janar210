#!/usr/bin/env node
// Draw an animated contribution grid with a snake that starts on the first box
// (top-left), then heads for the nearest day you contributed, eats it, and moves on,
// always stepping only on boxes inside the grid.
//
// Runs inside GitHub Actions (see .github/workflows/activity.yml).
// Needs GITHUB_TOKEN and GH_USER in the environment. No packages needed.

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";

const OUT = process.env.SNAKE_OUT || "assets/snake.svg";
const CELL = 12, GAP = 3;
const STEP = CELL + GAP;
const MONO = "ui-monospace,SFMono-Regular,Menlo,Consolas,'Liberation Mono',monospace";
const LEVELS = {
  NONE: "#161b22", FIRST_QUARTILE: "#1e3a5f", SECOND_QUARTILE: "#2f5f9e",
  THIRD_QUARTILE: "#70A5FD", FOURTH_QUARTILE: "#BF91F3",
};
const SNAKE = ["#9cc2ff", "#70A5FD", "#8f9ffa", "#a896f7", "#BF91F3"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Fixed decimals, rounding exact halves to even so numbers stay stable across runs.
export function fx(x, d) {
  const s = x.toFixed(d);
  const exact = Math.abs(x).toFixed(Math.min(100, d + 30));
  const tail = exact.slice(exact.indexOf(".") + 1 + d);
  if (!/^50*$/.test(tail)) return s;
  const down = (Math.trunc(Math.abs(x) * 10 ** d) / 10 ** d).toFixed(d);
  const lastDigit = Number(down.replace(".", "").slice(-1));
  const out = lastDigit % 2 === 0 ? down : s.replace("-", "");
  return (x < 0 ? "-" : "") + out;
}
// A float printed the plain way (5 -> "5.0", 11.82 -> "11.82").
export const num = (x) => (Number.isInteger(x) ? x.toFixed(1) : String(x));

const key = (c, r) => `${c},${r}`;

export async function fetchCalendar(user, token) {
  const query = `query($u:String!){user(login:$u){contributionsCollection{contributionCalendar{
      totalContributions weeks{contributionDays{date weekday contributionCount contributionLevel}}}}}}`;
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { Authorization: `bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables: { u: user } }),
  });
  if (!res.ok) throw new Error(`GitHub API returned ${res.status}`);
  const cal = (await res.json()).data.user.contributionsCollection.contributionCalendar;
  return [cal.weeks, cal.totalContributions];
}

export function render(weeks, total, note = "") {
  const cols = weeks.length;
  const gw = cols * STEP - GAP, gh = 7 * STEP - GAP;
  const W = 900;
  const ox = (W - gw) / 2;
  const oy = 58;
  const H = oy + gh + 40;
  const center = (c, r) => [ox + c * STEP + CELL / 2, oy + r * STEP + CELL / 2];

  // every box that exists in the grid (first and last weeks can be partial)
  const valid = new Set();
  const food = new Set();
  weeks.forEach((w, c) => w.contributionDays.forEach((d) => {
    valid.add(key(c, d.weekday));
    if (d.contributionLevel !== "NONE") food.add(key(c, d.weekday));
  }));
  let startCol = Infinity;
  for (const k of valid) {
    const [c, r] = k.split(",").map(Number);
    if (r === 0 && c < startCol) startCol = c;
  }
  const here = [startCol, 0]; // the top-left box

  // Shortest walk to the nearest target, stepping only on grid boxes
  // and never back onto the snake's own body (so it turns instead of reversing).
  function route(a, targets, body = []) {
    const prev = new Map([[key(...a), null]]);
    const seen = new Set([key(...a), ...body.map((p) => key(...p))]);
    let queue = [a];
    while (queue.length) {
      const nxt = [];
      for (const cur of queue) {
        if (targets.has(key(...cur))) {
          const path = [];
          let p = cur;
          while (p !== null) { path.push(p); p = prev.get(key(...p)); }
          return path.reverse();
        }
        const [c, r] = cur;
        for (const [dc, dr] of [[0, 1], [1, 0], [0, -1], [-1, 0]]) {
          const nb = [c + dc, r + dr];
          const nk = key(...nb);
          if (valid.has(nk) && !seen.has(nk)) {
            seen.add(nk);
            prev.set(nk, cur);
            nxt.push(nb);
          }
        }
      }
      queue = nxt;
    }
    return null;
  }

  const order = [here];
  const left = new Set(food);
  left.delete(key(...here));
  while (left.size) {
    const head = order[order.length - 1];
    const body = order.slice(-5, -1); // the four boxes right behind the head
    const leg = route(head, left, body) || route(head, left) || [head];
    order.push(...leg.slice(1));
    for (const p of leg) left.delete(key(...p));
    if (leg.length === 1) break;
  }
  const n = order.length;
  const firstVisit = new Map();
  order.forEach((p, i) => { if (!firstVisit.has(key(...p))) firstVisit.set(key(...p), i); });

  const stepTime = Math.min(0.14, 40.0 / Math.max(n - 1, 1)); // seconds per box
  const MOVE = Math.max((n - 1) * stepTime, 0.5);
  const T = MOVE + 3.0; // crawl, then a short pause
  const fracMove = MOVE / T;
  const tAt = (i) => (i / Math.max(n - 1, 1)) * fracMove;

  const cells = [];
  const eatTimes = [];
  const bite = 0.3 / T; // length of the bite effect, as a loop fraction
  weeks.forEach((w, c) => {
    for (const d of w.contributionDays) {
      const r = d.weekday;
      const x = ox + c * STEP, y = oy + r * STEP;
      const lvl = d.contributionLevel;
      if (lvl === "NONE") {
        cells.push(`<rect x="${fx(x, 1)}" y="${fx(y, 1)}" width="${CELL}" height="${CELL}" rx="2.5" fill="${LEVELS.NONE}"/>`);
        continue;
      }
      const fv = firstVisit.has(key(c, r)) ? firstVisit.get(key(c, r)) : n - 1;
      const k = tAt(fv);
      eatTimes.push(k);
      const col = LEVELS[lvl];
      const cx = x + CELL / 2, cy = y + CELL / 2;
      const a1 = k + bite * 0.35, a2 = k + bite, a3 = k + bite * 2.2; // swell, gone, effects faded
      const anim = `dur="${num(T)}s" repeatCount="indefinite"`;
      // the square: swells, then collapses into the snake, with a ripple ring
      cells.push(
        `<rect x="${fx(x, 1)}" y="${fx(y, 1)}" width="${CELL}" height="${CELL}" rx="2.5" fill="${LEVELS.NONE}"/>` +
        `<g transform="translate(${fx(cx, 1)},${fx(cy, 1)})"><rect x="${num(-CELL / 2)}" y="${num(-CELL / 2)}" width="${CELL}" height="${CELL}" rx="2.5" fill="${col}">` +
        `<title>${d.date}: ${d.contributionCount} contributions</title>` +
        `<animateTransform attributeName="transform" type="scale" ${anim} ` +
        `values="1;1;1.5;0;0;1" keyTimes="0;${fx(k, 4)};${fx(a1, 4)};${fx(a2, 4)};0.985;1"/></rect>` +
        `<circle r="6" fill="none" stroke="${col}" stroke-width="1.5" opacity="0">` +
        `<animate attributeName="r" ${anim} values="6;6;17;17" keyTimes="0;${fx(k, 4)};${fx(a3, 4)};1"/>` +
        `<animate attributeName="opacity" ${anim} values="0;0;.9;0;0" keyTimes="0;${fx(k, 4)};${fx(k + 0.001, 4)};${fx(a3, 4)};1"/></circle></g>`);
      // crumbs bursting outward
      for (const [dx, dy] of [[-9, -9], [9, -9], [-9, 9], [9, 9]]) {
        cells.push(
          `<rect x="-1.8" y="-1.8" width="3.6" height="3.6" rx="1" fill="${col}" opacity="0">` +
          `<animateTransform attributeName="transform" type="translate" ${anim} ` +
          `values="${fx(cx, 1)} ${fx(cy, 1)};${fx(cx, 1)} ${fx(cy, 1)};${fx(cx + dx, 1)} ${fx(cy + dy, 1)};${fx(cx + dx, 1)} ${fx(cy + dy, 1)}" ` +
          `keyTimes="0;${fx(k, 4)};${fx(a3, 4)};1"/>` +
          `<animate attributeName="opacity" ${anim} values="0;0;1;0;0" keyTimes="0;${fx(k, 4)};${fx(k + 0.001, 4)};${fx(a3, 4)};1"/></rect>`);
      }
      // "+N" floating up
      const cnt = d.contributionCount;
      if (cnt) {
        cells.push(
          `<text text-anchor="middle" font-size="10" font-weight="700" fill="${col}" opacity="0">+${cnt}` +
          `<animateTransform attributeName="transform" type="translate" ${anim} ` +
          `values="${fx(cx, 1)} ${fx(cy - 8, 1)};${fx(cx, 1)} ${fx(cy - 8, 1)};${fx(cx, 1)} ${fx(cy - 26, 1)};${fx(cx, 1)} ${fx(cy - 26, 1)}" ` +
          `keyTimes="0;${fx(k, 4)};${fx(k + bite * 4, 4)};1"/>` +
          `<animate attributeName="opacity" ${anim} values="0;0;1;1;0;0" ` +
          `keyTimes="0;${fx(k, 4)};${fx(k + 0.002, 4)};${fx(k + bite * 2.5, 4)};${fx(k + bite * 4, 4)};1"/></text>`);
      }
    }
  });

  // month labels
  const months = [];
  let last = null, lastC = -9;
  weeks.forEach((w, c) => {
    const m = MONTHS[Number(w.contributionDays[0].date.slice(5, 7)) - 1];
    if (m !== last && c - lastC >= 3 && c < cols - 2) {
      lastC = c;
      months.push(`<text x="${fx(ox + c * STEP, 1)}" y="${oy - 8}" font-size="9.5" fill="#6e7681">${m}</text>`);
      last = m;
    }
  });

  // snake: head + 4 body segments following the same path, each one step behind
  const pts = order.map(([c, r]) => center(c, r));
  if (pts.length === 1) pts.push(pts[0]);
  const path = "M" + pts.map(([x, y]) => `${fx(x, 1)} ${fx(y, 1)}`).join(" L");
  const segLag = stepTime / T; // one box of delay, as a loop fraction
  let gulp = "";
  if (eatTimes.length) {
    const kt = ["0"], vals = ["1"];
    let lastT = 0.0;
    for (const e of [...eatTimes].sort((a, b) => a - b)) {
      if (e - 0.0005 <= lastT || e + bite * 1.5 >= 0.999) continue;
      kt.push(fx(e - 0.0005, 4), fx(e + bite * 0.5, 4), fx(e + bite * 1.5, 4));
      vals.push("1", "1.45", "1");
      lastT = e + bite * 1.5;
    }
    kt.push("1"); vals.push("1");
    gulp = `<animateTransform attributeName="transform" type="scale" additive="sum" dur="${num(T)}s" ` +
      `repeatCount="indefinite" values="${vals.join(";")}" keyTimes="${kt.join(";")}"/>`;
  }
  const snake = [];
  for (let s = 0; s < 5; s++) {
    const start = s * segLag;
    const end = start + fracMove;
    const size = CELL - s * 1.2;
    const half = size / 2;
    const stop = Math.min(end, 0.97);
    snake.push(
      `<rect x="${fx(-half, 1)}" y="${fx(-half, 1)}" width="${fx(size, 1)}" height="${fx(size, 1)}" rx="3.5" fill="${SNAKE[s]}" opacity="0">` +
      `<animateMotion dur="${num(T)}s" repeatCount="indefinite" calcMode="linear" ` +
      `keyPoints="0;0;1;1" keyTimes="0;${fx(start, 4)};${fx(stop, 4)};1" path="${path}"/>` +
      `<animate attributeName="opacity" dur="${num(T)}s" repeatCount="indefinite" ` +
      `values="0;1;1;0;0" keyTimes="0;0.01;${fx(stop, 4)};${fx(stop + 0.02, 4)};1"/>` +
      (s === 0 ? gulp : "") + "</rect>");
  }

  const legendX = ox + gw - 5 * (CELL + 4) - 34;
  const legend =
    `<text x="${fx(legendX - 8, 1)}" y="${H - 14}" text-anchor="end" font-size="9.5" fill="#6e7681">less</text>` +
    Object.values(LEVELS).map((col, i) =>
      `<rect x="${fx(legendX + i * (CELL + 4), 1)}" y="${H - 24}" width="${CELL}" height="${CELL}" rx="2.5" fill="${col}"/>`).join("") +
    `<text x="${fx(legendX + 5 * (CELL + 4) + 4, 1)}" y="${H - 14}" font-size="9.5" fill="#6e7681">more</text>`;
  const noteSvg = note ? `<text x="${fx(ox, 1)}" y="${H - 14}" font-size="9.5" fill="#6e7681">${note}</text>` : "";

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Contribution grid with an animated snake: ${total} contributions in the last year">
<style>text{font-family:${MONO}}@media (prefers-reduced-motion:reduce){*{animation:none!important}}</style>
<rect x=".5" y=".5" width="${W - 1}" height="${H - 1}" rx="12" fill="#0d1117" stroke="#30363d"/>
<text x="${fx(ox, 1)}" y="26" font-size="13" font-weight="700" fill="#70A5FD">contributions · last 12 months</text>
<text x="${fx(ox + gw, 1)}" y="26" text-anchor="end" font-size="11.5" fill="#c9d1d9"><tspan fill="#38BDAE" font-weight="700">${total}</tspan> total</text>
${months.join("")}
${cells.join("")}
${[...snake].reverse().join("")}
${legend}${noteSvg}
</svg>`;
}

// Made-up data for trying the look without a token: node snake_grid.mjs --sample
export function sample() {
  let seed = 11;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const today = new Date();
  const utc = (d) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const end = utc(today);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 364 - end.getUTCDay());
  const weeks = [];
  let total = 0;
  for (let day = new Date(start); day <= end;) {
    const week = [];
    for (let i = 0; i < 7 && day <= end; i++) {
      const choices = [0, 0, 0, 0, 0, 0, 1, 2, 3, 5, 8];
      const n = choices[Math.floor(rand() * choices.length)];
      total += n;
      const lvl = n === 0 ? "NONE" : ["FIRST_QUARTILE", "SECOND_QUARTILE", "THIRD_QUARTILE", "FOURTH_QUARTILE"][Math.min(3, Math.floor(n / 2))];
      week.push({ date: day.toISOString().slice(0, 10), weekday: day.getUTCDay(), contributionCount: n, contributionLevel: lvl });
      day.setUTCDate(day.getUTCDate() + 1);
    }
    weeks.push({ contributionDays: week });
  }
  return [weeks, total];
}

async function main() {
  mkdirSync(dirname(OUT) || ".", { recursive: true });
  let svg;
  if (process.argv.includes("--sample")) {
    const [w, t] = sample();
    svg = render(w, t, "sample data · preview only");
  } else {
    const [w, t] = await fetchCalendar(process.env.GH_USER, process.env.GITHUB_TOKEN);
    svg = render(w, t);
  }
  writeFileSync(OUT, svg);
  console.log("wrote", OUT);
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().catch((err) => { console.error(err); process.exit(1); });
}
