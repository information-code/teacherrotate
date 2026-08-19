# 把沙盒結果（sandbox-product-result.tmp.json）＋教室中繼（sb-rooms.tmp.json）畫成專科教室週課表 HTML。
# 用法：python scripts/room-timetable-html.py <輸出.html>
import json, html, sys
from collections import defaultdict
out = sys.argv[1] if len(sys.argv) > 1 else 'sandbox-rooms.tmp.html'
rooms = json.load(open('sb-rooms.tmp.json', encoding='utf-8'))
res = json.load(open('sandbox-product-result.tmp.json', encoding='utf-8'))
r = res['result']; seed = res['p1Seed']
byRoom = defaultdict(dict)
for p in r['placed']:
    if p.get('roomId'):
        for q in ([p['period'], p['period'] + 1] if p['size'] == 2 else [p['period']]):
            byRoom[p['roomId']][(p['day'], q)] = p
teachers = sorted({p['teacherName'] for p in r['placed'] if p.get('roomId')})
palette = ['#3b6ea5','#b5533c','#5c8a3a','#8b5cb8','#c48a1c','#2f8f8a','#a4457a','#6f6f2f','#4b7bb0','#c2632b','#4d8f5f','#7a5fb0','#a08a2c','#3d8a9a','#b04c62','#5f6f9f','#2c6e49','#9a3b7a','#6b4f2a']
color = {t: palette[i % len(palette)] for i, t in enumerate(teachers)}
DAY = '一二三四五'
order = {'自然': 0, '智慧探究家：科技創新任務': 1, '視覺藝術': 2, '音樂': 3, '表演藝術': 4}
rooms.sort(key=lambda x: (order.get(x['subject'], 9), x['name'], x['no']))
def cell(rid, d, q):
    p = byRoom[rid].get((d, q))
    if p: return f'<td class="c" style="--t:{color[p["teacherName"]]}"><b>{html.escape(p["teacherName"])}</b><span>{html.escape(p["classLabel"])}{"（單）" if p["size"] == 1 else ""}</span></td>'
    return '<td></td>'
def stats(rid):
    ret = half = mixed = 0; days = defaultdict(set)
    for d in range(1, 6):
        seq = [byRoom[rid][(d, q)]['teacherName'] for q in range(1, 8) if (d, q) in byRoom[rid]]
        for t in set(seq): days[t].add(d)
        runs = []
        for t in seq:
            if not runs or runs[-1] != t: runs.append(t)
        if len(runs) != len(set(runs)): ret += 1
        if len(set(seq)) > 1: mixed += 1
        for qs in ([1, 2, 3, 4], [5, 6, 7]):
            if len({byRoom[rid][(d, q)]['teacherName'] for q in qs if (d, q) in byRoom[rid]}) > 1: half += 1
    return ret, half, mixed, days
sections = []; cur = None
for rm in rooms:
    if rm['subject'] != cur:
        cur = rm['subject']; sections.append(f'<h2>{html.escape(cur)}</h2>')
    off = set(rm['offSlots']); rows = ''
    for q in range(1, 8):
        tds = ''.join('<td class="off">不排課</td>' if f'{d}-{q}' in off else cell(rm['id'], d, q) for d in range(1, 6))
        rows += f'<tr class="{"lunch" if q == 5 else ""}"><th>{q}</th>{tds}</tr>'
    used = len(byRoom[rm['id']]); ret, half, mixed, days = stats(rm['id'])
    who = '、'.join(f'{html.escape(t)}＝週{"".join(DAY[d-1] for d in sorted(ds))}' for t, ds in days.items())
    sections.append(f'''<section class="room"><header><h3>{html.escape(rm["name"])}{(" " + html.escape(rm["no"])) if rm["no"] else ""}</h3>
<p class="meta">{html.escape(rm["floor"])}・{html.escape(rm["area"])}｜管理教師：{html.escape("、".join(rm["managers"]) or "—")}｜使用 {used} 節｜兩位以上老師的日子 <b class="{"warn" if mixed else ""}">{mixed}</b>｜半天兩位 {half}｜走了又回來 <b class="{"warn" if ret else ""}">{ret}</b></p>
<p class="meta">{who}</p></header>
<div class="wrap"><table><thead><tr><th></th>{"".join(f"<th>週{DAY[d-1]}</th>" for d in range(1, 6))}</tr></thead><tbody>{rows}</tbody></table></div></section>''')
legend = ''.join(f'<span class="lg" style="--t:{c}">{html.escape(t)}</span>' for t, c in color.items())
page = f'''<title>沙盒專科教室課表</title>
<style>
:root{{--bg:#f6f4ef;--paper:#fffdf9;--ink:#23211d;--mute:#6b665c;--line:#d9d3c7;--warn:#b5533c;--lunch:#eee9df}}
@media (prefers-color-scheme: dark){{:root:not([data-theme="light"]){{--bg:#1c1b18;--paper:#25231f;--ink:#ece7dc;--mute:#a39c8e;--line:#3d3931;--warn:#e0876f;--lunch:#2d2a24}}}}
:root[data-theme="dark"]{{--bg:#1c1b18;--paper:#25231f;--ink:#ece7dc;--mute:#a39c8e;--line:#3d3931;--warn:#e0876f;--lunch:#2d2a24}}
body{{background:var(--bg);color:var(--ink);font-family:"Noto Sans TC","PingFang TC","Microsoft JhengHei",system-ui,sans-serif;margin:0;padding:24px 20px 60px;line-height:1.45}}
main{{max-width:1080px;margin:0 auto}}
h1{{font-size:1.5rem;margin:0 0 4px;letter-spacing:.02em}} .sub{{color:var(--mute);margin:0 0 18px;font-size:.92rem}}
h2{{font-size:1.1rem;margin:30px 0 8px;padding-bottom:4px;border-bottom:1px solid var(--line)}}
.room{{background:var(--paper);border:1px solid var(--line);border-radius:6px;padding:12px 14px;margin:0 0 14px}}
.room h3{{margin:0;font-size:1rem}} .meta{{margin:2px 0 4px;color:var(--mute);font-size:.85rem}} .meta b.warn{{color:var(--warn)}}
.wrap{{overflow-x:auto;margin-top:6px}} table{{border-collapse:collapse;width:100%;min-width:560px;font-size:.82rem;font-variant-numeric:tabular-nums}}
th,td{{border:1px solid var(--line);padding:3px 4px;text-align:center;height:34px}} thead th{{background:var(--lunch);font-weight:600}} tbody th{{width:26px;color:var(--mute);font-weight:500}}
tr.lunch td,tr.lunch th{{border-top:3px double var(--line)}}
td.c{{background:color-mix(in srgb,var(--t) 16%,var(--paper));border-left:4px solid var(--t)}} td.c b{{display:block;font-weight:600}} td.c span{{display:block;color:var(--mute);font-size:.75rem}}
td.off{{background:repeating-linear-gradient(45deg,transparent 0 6px,var(--line) 6px 7px);color:var(--mute);font-size:.72rem}}
.legend{{display:flex;flex-wrap:wrap;gap:6px 12px;margin:0 0 6px;font-size:.8rem}} .lg::before{{content:"";display:inline-block;width:10px;height:10px;background:var(--t);margin-right:4px;border-radius:2px}}
</style>
<main><h1>沙盒專科教室課表</h1><p class="sub">115 學年・引擎種子 {seed}・未排 {len(r["unplaced"])}・軟分 {round(r["softPenalty"])}｜規則：每位老師集中在少數幾天（一天一位老師）→ 排不滿時上午一位下午一位 → 走了不回頭（自然＝硬限制）</p>
<div class="legend">{legend}</div>{"".join(sections)}</main>'''
open(out, 'w', encoding='utf-8').write(page)
print('ok', out)
