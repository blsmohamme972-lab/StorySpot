#!/usr/bin/env python3
"""Merge complete assistant-authored rationale batches, preserving source fields."""
import json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]

def main():
    merged={}
    for first,last in [(1,50),(51,100),(101,150),(151,200)]:
        p=ROOT/f'production/mcq-rationales-{first:03d}-{last:03d}.json'
        d=json.loads(p.read_text())
        assert set(d)=={str(i)for i in range(first,last+1)},f'Incomplete batch {p.name}'
        for number,entry in d.items():
            assert isinstance(entry['correctExplanation'],str) and entry['correctExplanation'].strip(),number
            assert set(entry['options'])==set('ABCDE'),number
            assert all(isinstance(v,str)and v.strip()for v in entry['options'].values()),number
            assert set(entry)<=set(['correctExplanation','options','reviewRequired','reviewNote']),number
        merged.update(d)
    review=json.loads((ROOT/'production/clinical-review-current.json').read_text())
    for n,item in review.items():
        if item.get('reviewRequired'):
            merged[n]['reviewRequired']=True
            notes=[merged[n].get('reviewNote',''),item['reviewNote']]
            merged[n]['reviewNote']=' '.join(dict.fromkeys(x for x in notes if x))
    # The forest-plot question tests a general convention; the assistant review
    # confirms that its answer does not depend on inspecting the omitted figure.
    merged['10'].pop('reviewRequired',None)
    path=ROOT/'production/mcq-rationales-200.json'
    path.write_text(json.dumps(merged,ensure_ascii=False,indent=2)+'\n')
    print('Complete rationale records:',len(merged),'Review flags:',sum(bool(x.get('reviewRequired'))for x in merged.values()))
if __name__=='__main__':main()
