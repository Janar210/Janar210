#!/usr/bin/env python3
"""Draw an animated contribution grid with a snake that starts on the first box
(top-left), then heads for the nearest day you contributed, eats it, and moves on,
always stepping only on boxes inside the grid.

Runs inside GitHub Actions (see .github/workflows/activity.yml).
Needs GITHUB_TOKEN and GH_USER in the environment. Standard library only.
"""
import datetime as dt
import json
import os
import sys
import urllib.request

OUT = os.environ.get("SNAKE_OUT", "assets/snake.svg")
CELL, GAP = 12, 3
STEP = CELL + GAP
MONO = "ui-monospace,SFMono-Regular,Menlo,Consolas,'Liberation Mono',monospace"
LEVELS = {"NONE": "#161b22", "FIRST_QUARTILE": "#1e3a5f", "SECOND_QUARTILE": "#2f5f9e",
          "THIRD_QUARTILE": "#70A5FD", "FOURTH_QUARTILE": "#BF91F3"}
SNAKE = ["#9cc2ff", "#70A5FD", "#8f9ffa", "#a896f7", "#BF91F3"]


def fetch(user, token):
    query = """query($u:String!){user(login:$u){contributionsCollection{contributionCalendar{
      totalContributions weeks{contributionDays{date weekday contributionCount contributionLevel}}}}}}"""
    body = json.dumps({"query": query, "variables": {"u": user}}).encode()
    req = urllib.request.Request("https://api.github.com/graphql", data=body,
                                 headers={"Authorization": f"bearer {token}", "Content-Type": "application/json"})
    cal = json.load(urllib.request.urlopen(req))["data"]["user"]["contributionsCollection"]["contributionCalendar"]
    return cal["weeks"], cal["totalContributions"]


def render(weeks, total, note=""):
    cols = len(weeks)
    gw, gh = cols * STEP - GAP, 7 * STEP - GAP
    W = 900
    ox = (W - gw) / 2
    oy = 58
    H = oy + gh + 40

    def center(c, r):
        return ox + c * STEP + CELL / 2, oy + r * STEP + CELL / 2

    # every box that exists in the grid (first and last weeks can be partial)
    valid = {(c, d["weekday"]) for c, w in enumerate(weeks) for d in w["contributionDays"]}
    food = {(c, d["weekday"]) for c, w in enumerate(weeks) for d in w["contributionDays"]
            if d["contributionLevel"] != "NONE"}
    start_col = min(c for c, r in valid if r == 0)
    here = (start_col, 0)                      # the top-left box

    def route(a, targets):
        """Shortest walk from a to the nearest target, stepping only on grid boxes."""
        prev, queue, seen = {a: None}, [a], {a}
        while queue:
            nxt = []
            for cur in queue:
                if cur in targets:
                    path = []
                    while cur is not None:
                        path.append(cur)
                        cur = prev[cur]
                    return path[::-1]
                c, r = cur
                for step in ((0, 1), (1, 0), (0, -1), (-1, 0)):
                    nb = (c + step[0], r + step[1])
                    if nb in valid and nb not in seen:
                        seen.add(nb)
                        prev[nb] = cur
                        nxt.append(nb)
            queue = nxt
        return [a]

    order, left = [here], set(food) - {here}
    while left:
        leg = route(order[-1], left)
        order += leg[1:]
        left -= set(leg)
    n = len(order)
    first_visit = {}
    for i, pos in enumerate(order):
        first_visit.setdefault(pos, i)

    step_time = min(0.14, 40.0 / max(n - 1, 1))   # seconds per box
    MOVE = max((n - 1) * step_time, 0.5)
    T = MOVE + 3.0                                 # crawl, then a short pause
    frac_move = MOVE / T

    def t_at(i):        # fraction of the loop when the head reaches path step i
        return (i / max(n - 1, 1)) * frac_move

    cells, eaten = [], 0
    for c, w in enumerate(weeks):
        for d in w["contributionDays"]:
            r = d["weekday"]
            x, y = ox + c * STEP, oy + r * STEP
            lvl = d["contributionLevel"]
            if lvl == "NONE":
                cells.append(f'<rect x="{x:.1f}" y="{y:.1f}" width="{CELL}" height="{CELL}" rx="2.5" fill="{LEVELS["NONE"]}"/>')
                continue
            eaten += 1
            k = t_at(first_visit.get((c, r), n - 1))
            k1 = min(k + 0.004, frac_move + 0.01)
            cells.append(
                f'<rect x="{x:.1f}" y="{y:.1f}" width="{CELL}" height="{CELL}" rx="2.5" fill="{LEVELS["NONE"]}"/>'
                f'<rect x="{x:.1f}" y="{y:.1f}" width="{CELL}" height="{CELL}" rx="2.5" fill="{LEVELS[lvl]}">'
                f'<title>{d["date"]}: {d["contributionCount"]} contributions</title>'
                f'<animate attributeName="opacity" dur="{T}s" repeatCount="indefinite" '
                f'values="1;1;0;0;1" keyTimes="0;{k:.4f};{k1:.4f};0.985;1"/></rect>')

    # month labels
    months, last, last_c = [], None, -9
    for c, w in enumerate(weeks):
        first = dt.date.fromisoformat(w["contributionDays"][0]["date"])
        m = first.strftime("%b")
        if m != last and c - last_c >= 3 and c < cols - 2:
            last_c = c
            months.append(f'<text x="{ox + c * STEP:.1f}" y="{oy - 8}" font-size="9.5" fill="#6e7681">{m}</text>')
            last = m

    # snake: head + 4 body segments following the same path, each one step behind
    pts = [center(c, r) for c, r in order]
    if len(pts) == 1:
        pts.append(pts[0])
    path = "M" + " L".join(f"{x:.1f} {y:.1f}" for x, y in pts)
    seg_lag = step_time / T               # one box of delay, as a loop fraction
    snake = []
    for s in range(5):
        start = s * seg_lag
        end = start + frac_move
        size = CELL - s * 1.2
        half = size / 2
        snake.append(
            f'<rect x="{-half:.1f}" y="{-half:.1f}" width="{size:.1f}" height="{size:.1f}" rx="3.5" fill="{SNAKE[s]}" opacity="0">'
            f'<animateMotion dur="{T}s" repeatCount="indefinite" calcMode="linear" '
            f'keyPoints="0;0;1;1" keyTimes="0;{start:.4f};{min(end, 0.97):.4f};1" path="{path}"/>'
            f'<animate attributeName="opacity" dur="{T}s" repeatCount="indefinite" '
            f'values="0;1;1;0;0" keyTimes="0;0.01;{min(end, 0.97):.4f};{min(end, 0.97) + 0.02:.4f};1"/></rect>')

    legend_x = ox + gw - 5 * (CELL + 4) - 34
    legend = (f'<text x="{legend_x - 8:.1f}" y="{H - 14}" text-anchor="end" font-size="9.5" fill="#6e7681">less</text>' +
              "".join(f'<rect x="{legend_x + i * (CELL + 4):.1f}" y="{H - 24}" width="{CELL}" height="{CELL}" rx="2.5" fill="{col}"/>'
                      for i, col in enumerate(LEVELS.values())) +
              f'<text x="{legend_x + 5 * (CELL + 4) + 4:.1f}" y="{H - 14}" font-size="9.5" fill="#6e7681">more</text>')
    note_svg = f'<text x="{ox:.1f}" y="{H - 14}" font-size="9.5" fill="#6e7681">{note}</text>' if note else ""

    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}" role="img" aria-label="Contribution grid with an animated snake: {total} contributions in the last year">
<style>text{{font-family:{MONO}}}@media (prefers-reduced-motion:reduce){{*{{animation:none!important}}}}</style>
<rect x=".5" y=".5" width="{W-1}" height="{H-1}" rx="12" fill="#0d1117" stroke="#30363d"/>
<text x="{ox:.1f}" y="26" font-size="13" font-weight="700" fill="#70A5FD">contributions · last 12 months</text>
<text x="{ox + gw:.1f}" y="26" text-anchor="end" font-size="11.5" fill="#c9d1d9"><tspan fill="#38BDAE" font-weight="700">{total}</tspan> total</text>
{"".join(months)}
{"".join(cells)}
{"".join(reversed(snake))}
{legend}{note_svg}
</svg>'''


def sample():
    import random
    random.seed(11)
    today = dt.date.today()
    start = today - dt.timedelta(days=364 + (today.weekday() + 1) % 7)
    weeks, day, total = [], start, 0
    while day <= today:
        week = []
        for _ in range(7):
            if day > today:
                break
            n = random.choice([0] * 6 + [1, 2, 3, 5, 8])
            total += n
            lvl = "NONE" if n == 0 else ["FIRST_QUARTILE", "SECOND_QUARTILE", "THIRD_QUARTILE", "FOURTH_QUARTILE"][min(3, n // 2)]
            week.append({"date": day.isoformat(), "weekday": (day.weekday() + 1) % 7, "contributionCount": n, "contributionLevel": lvl})
            day += dt.timedelta(days=1)
        weeks.append({"contributionDays": week})
    return weeks, total


if __name__ == "__main__":
    os.makedirs(os.path.dirname(OUT) or ".", exist_ok=True)
    if "--sample" in sys.argv:
        w, t = sample()
        svg = render(w, t, note="sample data · preview only")
    else:
        w, t = fetch(os.environ["GH_USER"], os.environ["GITHUB_TOKEN"])
        svg = render(w, t)
    open(OUT, "w").write(svg)
    print("wrote", OUT)
