#!/usr/bin/env python3
"""Display the existing story quotation at its recorded sentence boundaries."""
import argparse
import hashlib
import json
from pathlib import Path
import re
ROOT=Path(__file__).resolve().parents[1]

def attach(catalog,metadata):
    for story in catalog['stories']:
        track=metadata['tracks'][story['id']]['story']
        text=story['storyText'].strip()
        if hashlib.sha256(text.encode()).hexdigest()!=track['textSha256']:
            raise ValueError('Narration text changed: '+story['id'])
        quotes=re.findall(r'«([^«»]+)»',text)
        if not quotes:continue
        quote=quotes[-1].strip()
        joined=' '.join(s['text'] for s in track['segments'])
        start=joined.rfind(quote)
        if start<0:raise ValueError('Quotation not found in speech segments: '+story['id'])
        end=start+len(quote);offset=0;matched=[]
        for segment in track['segments']:
            stop=offset+len(segment['text'])
            if offset<end and stop>start:matched.append(segment)
            offset=stop+1
        if not matched:raise ValueError('No quotation timing: '+story['id'])
        story['quote']={'text':quote,'start':matched[0]['start'],'end':matched[-1]['end'],
                        'timingBasis':'Existing recorded story sentence boundaries'}
    return catalog

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--input',type=Path,required=True);p.add_argument('--output',type=Path,required=True);a=p.parse_args()
    result=attach(json.loads(a.input.read_text()),json.loads((ROOT/'production/audio-metadata.json').read_text()))
    a.output.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
    print('Attached recorded quotation spans for',sum('quote'in s for s in result['stories']),'stories. No narration generated.')
if __name__=='__main__':main()
