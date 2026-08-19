# 把 114-2 人工課表 PDF 解析成結構化 JSON（班級 → 星期 → 節次 → {科目, 教師, 教室, 外師}）。
# 純文字抽取無法判斷下午單一格屬於星期幾，故取每個字串的座標重建表格。
import io, json, os, re
from pypdf import PdfReader

import sys
# 用法：python parse-hand-timetable.py <PDF> <輸出 json 檔名>；預設 114-2
SRC = sys.argv[1] if len(sys.argv) > 1 else r"C:\Users\黃政昱老師\Downloads\114學年度第2學期課表.pdf"
OUT = sys.argv[2] if len(sys.argv) > 2 else 'hand-114-2.json'
CJK = re.compile(r'[\u3400-\u9fff\uf900-\ufaff：]')

def center(x, size, s):
    """字串置中排版，PDF 給的是起點；以字寬估中心（中日文≈size、半形≈size/2）。"""
    w = sum(size if CJK.match(c) else size * 0.5 for c in s)
    return x + w / 2

def parse_page(page):
    items = []
    def v(text, cm, tm, font, size):
        s = (text or "").strip()
        if s:
            items.append({'x': tm[4], 'y': tm[5], 'size': abs(size) or 12, 's': s})
    page.extract_text(visitor_text=v)
    for it in items:
        it['cx'] = center(it['x'], it['size'], it['s'])

    # 班級：標題列的「N年」「M」「班」
    head = ' '.join(i['s'] for i in sorted(items, key=lambda i: (-i['y'], i['x']))[:12])
    m = re.search(r'([一二三四五六])年\s*(\d+)\s*班', head.replace(' ', '')) or \
        re.search(r'([一二三四五六])年(\d+)', head.replace(' ', ''))
    grade = '一二三四五六'.index(m.group(1)) + 1 if m else 0
    idx = int(m.group(2)) if m else 0
    # 導師：標題右側「導師: XXX」
    hm = re.search(r'導師\s*:?\s*(\S+)', head)
    homeroom = hm.group(1) if hm else ''

    # 星期欄位中心
    days = {}
    for it in items:
        mm = re.fullmatch(r'星期([一二三四五])', it['s'])
        if mm:
            days['一二三四五'.index(mm.group(1)) + 1] = it['cx']
    # 節次列錨點（最左欄的 1~7）
    rows = {}
    for it in items:
        if re.fullmatch(r'[1-7]', it['s']) and it['x'] < 80:
            rows[int(it['s'])] = it['y']
    # 「星期三」偶爾被切成兩個 token 而漏抓 → 用已抓到的等距內插補回（欄距固定）
    if 2 <= len(days) < 5:
        ks = sorted(days)
        step = (days[ks[-1]] - days[ks[0]]) / (ks[-1] - ks[0])
        for d in range(1, 6):
            days.setdefault(d, days[ks[0]] + (d - ks[0]) * step)
    if len(days) != 5 or len(rows) < 4:
        return None

    dayC = sorted(days.items())
    gap = (dayC[-1][1] - dayC[0][1]) / 4
    # 列的範圍用相鄰錨點中線切（各列高度不一，多行科目名會超出固定窗）
    rk = sorted(rows)
    band = {}
    for i, p_ in enumerate(rk):
        hi = (rows[p_] + rows[rk[i-1]]) / 2 if i > 0 else rows[p_] + 40
        lo = (rows[p_] + rows[rk[i+1]]) / 2 if i < len(rk) - 1 else rows[p_] - 40
        band[p_] = (lo, hi)
    cells = {}
    for it in items:
        s = it['s']
        if it['x'] < 100: continue                       # 節次欄
        if re.fullmatch(r'\d{1,2}:\d{2}', s): continue    # 時間
        if re.fullmatch(r'星期[一二三四五]', s): continue
        if s in ('午', '休', '午休', '午 休'): continue   # 午休列（常被切成兩個單字 token）
        if '功課表' in s or s in ('導師', ':', '班') or re.fullmatch(r'\d+', s): continue
        d = min(days, key=lambda k: abs(days[k] - it['cx']))
        if abs(days[d] - it['cx']) > gap * 0.55: continue
        p = next((k for k in rk if band[k][0] <= it['y'] <= band[k][1]), None)
        if p is None: continue
        cells.setdefault((d, p), []).append(it)

    out = {}
    for (d, p), lst in cells.items():
        lst.sort(key=lambda i: -i['y'])
        lines = [i['s'] for i in lst]
        # 同一行被切成多段（長科目名換行）→ 依 y 分群
        grouped, cur, cury = [], [], None
        for i in lst:
            if cury is None or abs(i['y'] - cury) < 4:
                cur.append(i['s']); cury = i['y'] if cury is None else cury
            else:
                grouped.append(''.join(cur)); cur = [i['s']]; cury = i['y']
        if cur: grouped.append(''.join(cur))
        lines = grouped
        rec = {'subject': lines[0] if lines else '', 'teacher': '', 'room': '', 'co': ''}
        rest = lines[1:]
        # 長科目名（智慧探究家：科技創新任務課程）會佔 2~3 行 → 合併到遇見人名為止
        while rest and (rec['subject'].endswith('：') or rec['subject'].endswith('任務') or rec['subject'] == '智慧探究家' or rec['subject'] == '自然與生活科'):
            rec['subject'] += rest.pop(0)
        if rest: rec['teacher'] = rest.pop(0)
        for r in rest:
            if r.startswith('外師'): rec['co'] = r.replace('外師', '').strip() or '外師'
            elif '教室' in r: rec['room'] = r
        if '科技創新任務' in rec['subject']: rec['subject'] = '智慧探究家：科技創新任務課程'
        out[f'{d}-{p}'] = rec
    return {'grade': grade, 'index': idx, 'homeroom': homeroom, 'cells': out}

r = PdfReader(SRC)
classes = []
for i, pg in enumerate(r.pages):
    c = parse_page(pg)
    if c is None:
        print(f'⚠ 第 {i+1} 頁解析失敗')
        continue
    classes.append(c)
io.open(os.path.join(os.path.dirname(os.path.abspath(__file__)), OUT), 'w', encoding='utf-8').write(json.dumps(classes, ensure_ascii=False, indent=1))
print(f'班級 {len(classes)}　總格數 {sum(len(c["cells"]) for c in classes)}')
for c in classes[:1] + classes[20:21]:
    print(f'--- {c["grade"]}年{c["index"]}班 {len(c["cells"])} 格 ---')
    for k in sorted(c['cells'], key=lambda k: (int(k.split("-")[1]), int(k.split("-")[0]))):
        v = c['cells'][k]
        print(f'  {k} {v["subject"]}／{v["teacher"]}' + (f'／{v["room"]}' if v['room'] else '') + (f'／外師{v["co"]}' if v['co'] else ''))
