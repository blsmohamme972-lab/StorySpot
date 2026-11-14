#!/usr/bin/env python3
"""Attach verified local speech and visually reviewed, sentence-timed focus cues."""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

def main():
    authoring = ROOT / 'production/remote-library'
    path = authoring / 'catalog-source.json'
    catalog = json.loads(path.read_text())
    audio = json.loads((ROOT / 'production/audio-metadata.json').read_text())['tracks']
    visuals = json.loads((ROOT / 'production/visual-cues.json').read_text())
    sequence_overrides = {
        ('story-5','story'): ['pipes','wagon','chain','cloak','wagon',None,None,'cloak'],
        ('story-9','story'): ['chimney','distal','figures','scale',None,None],
        ('story-12','story'): ['knot','magnifier','maze','clocks','knot',None,None],
        ('story-13','story'): ['city','river','bridge','bell','bubbles',None,None],
        ('story-14','story'): ['house','fortress','roots','pills','surgery','house',None,None],
        ('story-15','story'): ['house','jester','dominoes','distant','scholar','dominoes',None,None],
        ('story-7-gate','explanation'): ['bundle','nerve','inset','bundle','age'],
        ('story-1','story'): ['cage','cage','bellows','neck','neck',None,'cage'],
        ('story-7-clamp','story'): ['clamp','vessels','sparks','age',None,'clamp'],
        ('story-7-gate','story'): ['bundle','nerve','age','inset',None],
        ('story-10','story'): ['large','large','ropes',None],
        ('story-11','story'): ['drainage','relief','plug','trial','correction','relief',None],
    }
    overview = {'x':.5, 'y':.5, 'zoom':1, 'pointer':False, 'label':''}
    for story in catalog['stories']:
        tracks = audio[story['id']]
        visual = visuals[story['drive']['imageId']]
        points = {point['id']: {**{key: point[key] for key in ['x','y','zoom','label']}, 'pointer':True} for point in visual['points']}
        for kind, src_key, duration_key in [('story','storyAudio','duration'),('explanation','explanationAudio','explanationDuration')]:
            track = tracks[kind]
            source = authoring / track['file']
            assert hashlib.sha256(source.read_bytes()).hexdigest() == track['sha256'], f'Changed audio {source}'
            assert hashlib.sha256(story[kind+'Text'].strip().encode()).hexdigest() == track['textSha256'], f'Stale narration {story["id"]}/{kind}'
            story[src_key] = track['file']
            story[duration_key] = track['duration']
            sequence = sequence_overrides.get((story['id'],kind),visual[kind+'Sequence'])
            assert len(sequence) == len(track['segments']), f'Unmapped sentence {story["id"]}/{kind}'
            cue_list = [{'time':0, **overview}]
            previous = overview
            for index, (segment, point_id) in enumerate(zip(track['segments'],sequence)):
                target = points[point_id] if point_id else overview
                start = segment['start']
                next_start = track['segments'][index+1]['start'] if index+1<len(track['segments']) else track['duration']
                # Provider sentence spans can overlap by ~50 ms. Focus changes
                # at the following sentence's start, never after it.
                end = max(start+.01, min(segment['end'],next_start))
                # Hold the previous symbol until this sentence starts, then ease
                # to its inspected target over 0.55 seconds and hold it there.
                cue_list.append({'time':round(start,4), **previous})
                cue_list.append({'time':round(min(start+.55,end),4), **target})
                cue_list.append({'time':round(end,4), **target})
                previous = target
            cue_list.append({'time':track['duration'], **previous})
            story['cues' if kind=='story' else 'explanationCues'] = cue_list
        story['imageAlt'] = visual['summary']
        story['category'] = story['topic'].upper()
        story['timing'] = {'basis':'Speech-provider sentence boundaries with visually inspected symbol targets', 'visualReview':True}
        story['narration'] = {'synthetic': True, 'storyVoice': tracks['story']['voice'], 'explanationVoice': tracks['explanation']['voice']}
    path.write_text(json.dumps(catalog, ensure_ascii=False, indent=2)+'\n')
    print(f'Attached {len(catalog["stories"])*2} verified speech tracks')

if __name__ == '__main__':
    main()
