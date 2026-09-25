#!/usr/bin/env python3
"""Draw an animated contribution graph (last 31 days) for a GitHub profile README.

Runs inside GitHub Actions (see .github/workflows/activity.yml).
Needs GITHUB_TOKEN and GH_USER in the environment. Standard library only.
"""
import datetime as dt
import json
import os
import sys
import urllib.request

OUT = os.environ.get("OUT", "assets/activity.svg")
DAYS = 31
W, H = 900, 300
PAD_L, PAD_R, PAD_T, PAD_B = 56, 28, 70, 46
MONO = "ui-monospace,SFMono-Regular,Menlo,Consolas,'Liberation Mono',monospace"
LINE, POINT, AREA, TITLE = "#BF91F3", "#38BDAE", "#BF91F3", "#70A5FD"


def fetch(user, token):
    to = dt.datetime.utcnow().replace(hour=23, minute=59, second=59, microsecond=0)
    frm = (to - dt.timedelta(days=DAYS - 1)).replace(hour=0, minute=0, second=0)
    query = """query($u:String!,$f:DateTime!,$t:DateTime!){user(login:$u){
      contributionsCollection(from:$f,to:$t){contributionCalendar{weeks{contributionDays{date contributionCount}}}}}}"""
    body = json.dumps({"query": query, "variables": {"u": user, "f": frm.isoformat() + "Z", "t": to.isoformat() + "Z"}}).encode()
    req = urllib.request.Request("https://api.github.com/graphql", data=body,
                                 headers={"Authorization": f"bearer {token}", "Content-Type": "application/json"})
    data = json.load(urllib.request.urlopen(req))
    weeks = data["data"]["user"]["contributionsCollection"]["contributionCalendar"]["weeks"]
    days = [(d["date"], d["contributionCount"]) for w in weeks for d in w["contributionDays"]]
    return days[-DAYS:]


def render(days, note=""):
    counts = [c for _, c in days]
    total = sum(counts)
    top = max(max(counts), 4)
    top = top + (-top % 4)  # round up so the grid divides evenly
    iw, ih = W - PAD_L - PAD_R, H - PAD_T - PAD_B
    step = iw / (len(days) - 1)

    def xy(i, c):
        return PAD_L + i * step, PAD_T + ih - (c / top) * ih

    pts = [xy(i, c) for i, c in enumerate(counts)]
    line = "M" + " L".join(f"{x:.1f} {y:.1f}" for x, y in pts)
    area = line + f" L{pts[-1][0]:.1f} {PAD_T+ih} L{pts[0][0]:.1f} {PAD_T+ih} Z"
    length = sum(((pts[i][0] - pts[i-1][0]) ** 2 + (pts[i][1] - pts[i-1][1]) ** 2) ** .5 for i in range(1, len(pts))) + 10

    grid = ""
    for k in range(5):
        v = top * k / 4
        y = PAD_T + ih - (v / top) * ih
        grid += (f'<line x1="{PAD_L}" x2="{W-PAD_R}" y1="{y:.1f}" y2="{y:.1f}" stroke="#21262d"/>'
                 f'<text x="{PAD_L-10}" y="{y+3.5:.1f}" text-anchor="end" font-size="10" fill="#6e7681">{v:g}</text>')
    for i, (d, _) in enumerate(days):
        if i % 5 == 0 or i == len(days) - 1:
            x = PAD_L + i * step
            label = dt.date.fromisoformat(d).strftime("%d %b")
            grid += f'<text x="{x:.1f}" y="{H-PAD_B+20}" text-anchor="middle" font-size="10" fill="#6e7681">{label}</text>'

    T = 9.0
    draw_end = 3.2 / T * 100
    dots = ""
    css_dots = ""
    for i, (x, y) in enumerate(pts):
        at = (0.2 + 3.0 * i / (len(pts) - 1)) / T * 100
        css_dots += (f"@keyframes p{i}{{0%,{at:.2f}%{{transform:scale(0)}}{at+1.5:.2f}%,94%{{transform:scale(1)}}100%{{transform:scale(0)}}}}"
                     f".p{i}{{animation:p{i} {T}s ease-out infinite}}")
        dots += f'<circle class="pt p{i}" cx="{x:.1f}" cy="{y:.1f}" r="3.4" fill="{POINT}"/>'
    lx, ly = pts[-1]
    best_i = max(range(len(counts)), key=lambda i: counts[i])
    bx, by = pts[best_i]

    css = f"""text{{font-family:{MONO}}}
@keyframes draw{{0%{{stroke-dashoffset:{length:.0f}}}{draw_end:.2f}%,94%{{stroke-dashoffset:0}}100%{{stroke-dashoffset:{length:.0f}}}}}
.line{{stroke-dasharray:{length:.0f};animation:draw {T}s cubic-bezier(.5,0,.3,1) infinite}}
@keyframes area{{0%,10%{{opacity:0}}{draw_end:.2f}%,94%{{opacity:1}}100%{{opacity:0}}}}.area{{animation:area {T}s ease-out infinite}}
.pt{{transform-box:fill-box;transform-origin:center}}
{css_dots}
@keyframes ring{{0%{{transform:scale(1);opacity:.9}}100%{{transform:scale(3.2);opacity:0}}}}
.ring{{transform-box:fill-box;transform-origin:center;animation:ring 1.6s ease-out infinite}}
@keyframes tag{{0%,{draw_end:.2f}%{{opacity:0}}{draw_end+4:.2f}%,94%{{opacity:1}}100%{{opacity:0}}}}.tag{{animation:tag {T}s ease-out infinite}}
@keyframes scan{{0%{{transform:translateX(0);opacity:0}}5%{{opacity:.9}}{draw_end:.2f}%{{transform:translateX({iw}px);opacity:.9}}{draw_end+2:.2f}%,100%{{opacity:0;transform:translateX({iw}px)}}}}
.scan{{animation:scan {T}s cubic-bezier(.5,0,.3,1) infinite}}
@media (prefers-reduced-motion:reduce){{*{{animation:none!important}}}}"""

    note_svg = f'<text x="{W-PAD_R}" y="{H-10}" text-anchor="end" font-size="9.5" fill="#6e7681">{note}</text>' if note else ""
    svg = f'''<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}" role="img" aria-label="Contribution graph: {total} contributions in the last {DAYS} days">
<style>{css}</style>
<defs><linearGradient id="ag" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="{AREA}" stop-opacity=".35"/><stop offset="1" stop-color="{AREA}" stop-opacity="0"/></linearGradient>
<linearGradient id="sg" x1="0" x2="1"><stop offset="0" stop-color="{TITLE}" stop-opacity="0"/><stop offset="1" stop-color="{TITLE}" stop-opacity=".5"/></linearGradient></defs>
<rect x=".5" y=".5" width="{W-1}" height="{H-1}" rx="12" fill="#0d1117" stroke="#30363d"/>
<text x="{PAD_L}" y="34" font-size="15" font-weight="700" fill="{TITLE}">contributions · last {DAYS} days</text>
<text x="{W-PAD_R}" y="34" text-anchor="end" font-size="12" fill="#c9d1d9"><tspan fill="{POINT}" font-weight="700">{total}</tspan> total  ·  best day <tspan fill="{LINE}" font-weight="700">{counts[best_i]}</tspan></text>
{grid}
<path class="area" d="{area}" fill="url(#ag)"/>
<path class="line" d="{line}" fill="none" stroke="{LINE}" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"/>
<rect class="scan" x="{PAD_L-40}" y="{PAD_T}" width="40" height="{ih}" fill="url(#sg)"/>
{dots}
<circle cx="{lx:.1f}" cy="{ly:.1f}" r="4" fill="none" stroke="{POINT}" class="ring"/>
<g class="tag"><rect x="{bx-22:.1f}" y="{by-30:.1f}" width="44" height="18" rx="4" fill="#1d1530" stroke="{LINE}" stroke-opacity=".6"/>
<text x="{bx:.1f}" y="{by-17.5:.1f}" text-anchor="middle" font-size="10" fill="#e6edf3">{counts[best_i]}</text></g>
{note_svg}
</svg>'''
    return svg


def placeholder():
    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="120" viewBox="0 0 {W} 120" role="img" aria-label="Contribution graph is being generated">
<style>text{{font-family:{MONO}}}@keyframes spin{{to{{transform:rotate(360deg)}}}}.s{{transform-origin:40px 60px;animation:spin 1s linear infinite}}</style>
<rect x=".5" y=".5" width="{W-1}" height="119" rx="12" fill="#0d1117" stroke="#30363d"/>
<circle class="s" cx="40" cy="60" r="12" fill="none" stroke="{LINE}" stroke-width="3" stroke-dasharray="40 40"/>
<text x="68" y="56" font-size="13" fill="#c9d1d9">Contribution graph is being generated…</text>
<text x="68" y="76" font-size="11" fill="#6e7681">Actions → "Update activity graph" → Run workflow</text>
</svg>'''


if __name__ == "__main__":
    os.makedirs(os.path.dirname(OUT) or ".", exist_ok=True)
    if "--placeholder" in sys.argv:
        svg = placeholder()
    elif "--sample" in sys.argv:
        import random
        random.seed(4)
        today = dt.date.today()
        days = [((today - dt.timedelta(days=DAYS - 1 - i)).isoformat(), random.choice([0, 1, 2, 3, 4, 5, 6, 8, 9, 12])) for i in range(DAYS)]
        svg = render(days, note="sample data · preview only")
    else:
        svg = render(fetch(os.environ["GH_USER"], os.environ["GITHUB_TOKEN"]))
    open(OUT, "w").write(svg)
    print("wrote", OUT)
