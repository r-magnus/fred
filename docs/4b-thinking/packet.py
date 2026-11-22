#!/usr/bin/env python3
"""Blind A/B packet: every reply that differs between baseline and a variant, sides shuffled.
usage: packet.py <base_dir> <new_dir> <out_prefix>  -> <out>.md (blind) and <out>-key.json"""
import json, random, sys, os
base, new, out = sys.argv[1:4]
random.seed(271)
items = []
def load(p): return [json.loads(l) for l in open(p)] if os.path.exists(p) else []
for s in ['breadth', 'assembled', 'assembled-sealed', 'tuning']:
    b = {r['questionId']: r for r in load(f'{base}/{s}.jsonl')}
    for r in load(f'{new}/{s}.jsonl'):
        o = b.get(r['questionId'])
        if o and (o['answer'] or '') != (r['answer'] or ''):
            items.append(dict(id=f"{s}:{r['questionId']}", ctx='', q=r['question'], a=o['answer'], b=r['answer'], ao=o['outcome'], bo=r['outcome']))
for c in ['chats-phone', 'chats-long-dev']:
    key = lambda r: (r['chatId'], r.get('wording', 0), r['turn'])
    b = {key(r): r for r in load(f'{base}/{c}.jsonl')}
    rows = load(f'{new}/{c}.jsonl')
    hist = {}
    for r in rows:
        k = key(r); o = b.get(k)
        prev = hist.get(k[:2], [])
        if o and ((o.get('answer') or '') != (r.get('answer') or '') or (o.get('opener') or '') != (r.get('opener') or '')):
            fa = lambda x: ((x.get('opener') or '') + '\n' + (x.get('answer') or '')).strip()
            items.append(dict(id=f"{c}:{k[0]}#{k[2]}", ctx=' / '.join(prev[-3:]), q=r['question'], a=fa(o), b=fa(r), ao=o['outcome'], bo=r['outcome']))
        hist[k[:2]] = prev + [r['question']]
key = {}
with open(out + '.md', 'w') as f:
    for i, it in enumerate(items, 1):
        flip = random.random() < 0.5
        x, y = (it['b'], it['a']) if flip else (it['a'], it['b'])
        key[str(i)] = dict(id=it['id'], X='new' if flip else 'base')
        f.write(f"## {i}. {it['q']}\n")
        if it['ctx']: f.write(f"_earlier: {it['ctx']}_\n")
        f.write(f"\n**X:**\n{x}\n\n**Y:**\n{y}\n\n")
json.dump(key, open(out + '-key.json', 'w'), indent=1)
print(len(items), 'changed replies')
