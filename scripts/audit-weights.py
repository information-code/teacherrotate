# 依 114-2 人工課表檢核每一條權重規則：算違反數與「機會數」，得出違反率。
# 違反率低＝學校真的在乎（權重該高）；違反率高＝做不到或不在乎（權重該低或關）。
import json, io, os
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
cs = json.load(open(os.path.join(HERE, 'hand-114-2.json'), encoding='utf-8'))
DAYS = [1, 2, 3, 4, 5]
MORNING = [1, 2, 3, 4]
R = []          # 報告行
def p(s=''): R.append(s)

def cell(c, d, q): return c['cells'].get(f'{d}-{q}')
def isHR(c, v): return v and v['teacher'] == c['homeroom']       # 導師自己上的課
def slots(c, d): return [q for q in range(1, 8) if cell(c, d, q)]

p('══════ 一、班級側規則 ══════')

# ① 同科不隔天
adj = tot = 0
bad = []
for c in cs:
    bysub = defaultdict(set)
    for d in DAYS:
        for q in range(1, 8):
            v = cell(c, d, q)
            if v: bysub[v['subject']].add(d)
    for sub, ds in bysub.items():
        ds = sorted(ds)
        if len(ds) < 2: continue
        tot += len(ds) - 1
        hit = sum(1 for i in range(len(ds) - 1) if ds[i + 1] - ds[i] == 1)
        adj += hit
        if hit: bad.append(f'{c["grade"]}年{c["index"]}班 {sub}')
p(f'① 同科不隔天：相鄰兩天出現 {adj} 次／可比較的相鄰對 {tot}　違反率 {adj/tot:.0%}')

# ② 科任課同日成塊（上/下午各自計）
blk = seg = 0
for c in cs:
    for d in DAYS:
        for half in (MORNING, [5, 6, 7]):
            occ = [q for q in half if cell(c, d, q) and not isHR(c, cell(c, d, q))]
            if not occ: continue
            seg += 1
            n = 1 + sum(1 for i in range(len(occ) - 1) if occ[i + 1] - occ[i] > 1)
            if n > 1: blk += 1
p(f'② 科任課同日成塊：被切成多塊 {blk} 個半天／有科任課的半天 {seg}　違反率 {blk/seg:.0%}')

# ③ 上午導師課節數
dist = defaultdict(int)
for c in cs:
    for d in DAYS:
        if not slots(c, d): continue
        n = sum(1 for q in MORNING if isHR(c, cell(c, d, q)))
        dist[n] += 1
tt = sum(dist.values())
p(f'③ 上午導師課節數分布（共 {tt} 個上課日）：' + '　'.join(f'{k} 節×{dist[k]}({dist[k]/tt:.0%})' for k in sorted(dist)))
p(f'   → 上午 0 節導師課的日子 {dist[0]}（{dist[0]/tt:.0%}）、＜2 節 {dist[0]+dist[1]}（{(dist[0]+dist[1])/tt:.0%}）')

# ④ 導師每日節數
dm = defaultdict(int); mx = 0
for c in cs:
    for d in DAYS:
        if not slots(c, d): continue
        n = sum(1 for q in range(1, 8) if isHR(c, cell(c, d, q)))
        dm[n] += 1; mx = max(mx, n)
tt2 = sum(dm.values())
p(f'④ 導師每日節數分布：' + '　'.join(f'{k}節×{dm[k]}' for k in sorted(dm)) + f'　最大 {mx}')
for N in (3, 4, 5):
    over = sum(v for k, v in dm.items() if k > N)
    p(f'   上限 N={N}：超標 {over}／{tt2} 日（{over/tt2:.0%}）')

# ⑤ 導師連上（不連四）
run = defaultdict(int)
for c in cs:
    for d in DAYS:
        if not slots(c, d): continue
        best = cur = 0
        for q in range(1, 8):
            cur = cur + 1 if isHR(c, cell(c, d, q)) else 0
            best = max(best, cur)
        run[best] += 1
tt3 = sum(run.values())
p(f'⑤ 導師最長連上分布：' + '　'.join(f'{k}連×{run[k]}' for k in sorted(run)))
for N in (3, 4):
    over = sum(v for k, v in run.items() if k > N)
    p(f'   上限 {N} 連：超標 {over}／{tt3} 日（{over/tt3:.0%}）')

# ⑥ 科目避開節次
pe45 = pe = 0; last7 = l7 = 0
EXAM = {'社會', '自然科學', '英語文', '英語主題課程', '國語文', '數學'}
for c in cs:
    for d in DAYS:
        full = 7 in [q for q in range(1, 8) if cell(c, d, q)] or len(slots(c, d)) > 4
        for q in range(1, 8):
            v = cell(c, d, q)
            if not v: continue
            if v['subject'] == '體育':
                pe += 1
                if q in (4, 5): pe45 += 1
            if full and v['subject'] in EXAM:
                l7 += 1
                if q == 7: last7 += 1
p(f'⑥ 體育避第 4、5 節：{pe45}／{pe} 堂體育在 4 或 5 節（{pe45/pe:.0%}）')
p(f'   考科避整天日第 7 節：{last7}／{l7} 堂（{last7/l7:.0%}）')

# ⑦ 科目互斥同日
for a, b in (('體育', '健康'), ('自然科學', '社會')):
    hit = day = 0
    for c in cs:
        for d in DAYS:
            subs = {cell(c, d, q)['subject'] for q in range(1, 8) if cell(c, d, q)}
            if a in subs or b in subs: day += 1
            if a in subs and b in subs: hit += 1
    p(f'⑦ {a} 與 {b} 同日：{hit}／{day} 個相關日（{hit/day:.0%}）')

p()
p('══════ 二、教師側規則（排除導師在自己班的課）══════')
# 建教師課表
tt_ = defaultdict(dict)   # teacher -> (d,q) -> (classKey, subject, room)
for c in cs:
    for k, v in c['cells'].items():
        d, q = map(int, k.split('-'))
        if isHR(c, v): continue
        tt_[v['teacher']][(d, q)] = (f'{c["grade"]}-{c["index"]}', v['subject'], v['room'])
p(f'科任／鐘點／行政教師共 {len(tt_)} 位、{sum(len(x) for x in tt_.values())} 堂')

dmax = defaultdict(int); cmax = defaultdict(int); gapseg = defaultdict(int); bal = defaultdict(int)
for t, sc in tt_.items():
    loads = []
    for d in DAYS:
        qs = sorted(q for (dd, q) in sc if dd == d)
        loads.append(len(qs))
        if not qs: continue
        dmax[len(qs)] += 1
        best = cur = 0
        for q in range(1, 8):
            cur = cur + 1 if q in qs else 0
            best = max(best, cur)
        cmax[best] += 1
        segs = sum(1 for i in range(len(qs) - 1) if qs[i + 1] - qs[i] > 1)
        gapseg[segs] += 1
    bal[max(loads) - min(loads)] += 1
p('⑧ 科任每日節數分布：' + '　'.join(f'{k}節×{dmax[k]}' for k in sorted(dmax)))
for N in (5, 6):
    p(f'   上限 N={N}：超標 {sum(v for k,v in dmax.items() if k>N)}／{sum(dmax.values())} 人日')
p('⑨ 科任最長連上分布：' + '　'.join(f'{k}連×{cmax[k]}' for k in sorted(cmax)))
for N in (3, 4, 5):
    p(f'   上限 N={N}：超標 {sum(v for k,v in cmax.items() if k>N)}／{sum(cmax.values())} 人日（{sum(v for k,v in cmax.items() if k>N)/sum(cmax.values()):.0%}）')
p('⑩ 課間空堂段數分布：' + '　'.join(f'{k}段×{gapseg[k]}' for k in sorted(gapseg)) +
  f'　→ 超過 1 段 {sum(v for k,v in gapseg.items() if k>1)}／{sum(gapseg.values())} 人日')
p('⑪ 每週最重日與最輕日差：' + '　'.join(f'差{k}×{bal[k]}' for k in sorted(bal)))

# ⑫ 同型態同日
def doubles(sc):
    """回傳 (連堂起始格集合, 單節格集合)。連堂＝同班同科相鄰兩節、不跨午休。"""
    dbl, sgl = set(), set()
    keys = sorted(sc)
    used = set()
    for (d, q) in keys:
        if (d, q) in used: continue
        nxt = sc.get((d, q + 1))
        if nxt and q != 4 and sc[(d, q)][0] == nxt[0] and sc[(d, q)][1] == nxt[1]:
            dbl.add((d, q)); used.add((d, q)); used.add((d, q + 1))
        else:
            sgl.add((d, q)); used.add((d, q))
    return dbl, sgl
mix = tday = 0
for t, sc in tt_.items():
    dbl, sgl = doubles(sc)
    for d in DAYS:
        hasD = any(dd == d for dd, _ in dbl); hasS = any(dd == d for dd, _ in sgl)
        if hasD or hasS: tday += 1
        if hasD and hasS: mix += 1
p(f'⑫ 同型態同日：連堂與單節混排 {mix}／{tday} 人日（{mix/tday:.0%}）')

# ⑬ 走動成本：相鄰兩堂課換教室
mov = pair = 0
for t, sc in tt_.items():
    for d in DAYS:
        qs = sorted(q for (dd, q) in sc if dd == d)
        for i in range(len(qs) - 1):
            a = sc[(d, qs[i])]; b = sc[(d, qs[i + 1])]
            pair += 1
            ra = a[2] or f'原班{a[0]}'; rb = b[2] or f'原班{b[0]}'
            if ra != rb: mov += 1
p(f'⑬ 相鄰兩堂課換場地：{mov}／{pair} 組（{mov/pair:.0%}）')

p()
p('══════ 三、專科教室：連堂 vs 單節 ══════')
for sub in ('自然科學', '智慧探究家：科技創新任務課程', '視覺藝術', '音樂', '表演藝術'):
    dd = ds = rd = rs = 0
    for c in cs:
        for d in DAYS:
            q = 1
            while q <= 7:
                v = cell(c, d, q)
                if v and v['subject'] == sub:
                    nxt = cell(c, d, q + 1)
                    isDbl = bool(nxt and nxt['subject'] == sub and nxt['teacher'] == v['teacher'] and q != 4)
                    if isDbl:
                        dd += 1; rd += 1 if v['room'] else 0; q += 2; continue
                    ds += 1; rs += 1 if v['room'] else 0
                q += 1
    if dd + ds == 0: continue
    a = f'連堂 {dd} 組（進專科教室 {rd}＝{rd/dd:.0%}）' if dd else '無連堂'
    b = f'單節 {ds} 堂（進專科教室 {rs}＝{rs/ds:.0%}）' if ds else '無單節'
    p(f'{sub}：{a}／{b}')

io.open('hand-report.tmp.txt', 'w', encoding='utf-8').write('\n'.join(R))
print('\n'.join(R))
