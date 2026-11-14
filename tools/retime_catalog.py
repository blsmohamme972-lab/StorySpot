#!/usr/bin/env python3
"""Replace eased camera destinations with supplied sentence-boundary spotlight intervals.

No media is generated or modified. Alignment uses existing provider metadata;
this is not a human listening check or a new review of target coordinates.
"""
from __future__ import annotations

import argparse
import ast
import copy
import hashlib
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
INACTIVE = {"x": .5, "y": .5, "zoom": 1, "pointer": False, "label": ""}


def recorded_overrides(path: Path = ROOT / 'tools/finalize_catalog.py') -> dict:
    """Read the existing literal map without executing the authoring script."""
    tree = ast.parse(path.read_text())
    for node in ast.walk(tree):
        if isinstance(node, ast.Assign) and any(isinstance(target, ast.Name) and target.id == 'sequence_overrides' for target in node.targets):
            return ast.literal_eval(node.value)
    raise ValueError('Existing sentence-to-symbol override map is missing')


def finite(value, label: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError(f'{label} must be finite')
    return float(value)


def retime_catalog(catalog: dict, audio: dict, visuals: dict, overrides: dict | None = None) -> tuple[dict, dict]:
    result = copy.deepcopy(catalog)
    tracks = audio['tracks']
    overrides = recorded_overrides() if overrides is None else overrides
    report = {'operation': 'Sentence-boundary spotlight retiming', 'stories': 0, 'tracks': [],
              'alignment': 'Existing speech-provider sentence boundaries, not word-level alignment',
              'coordinates': 'Preserved existing inspected targets and recorded sequence map; no new coordinate inspection',
              'mediaModified': False, 'humanListeningPerformed': False}
    ids = set()
    for story in result['stories']:
        story_id = story['id']
        if story_id in ids:
            raise ValueError(f'Duplicate story ID {story_id}')
        ids.add(story_id)
        visual = visuals[story['drive']['imageId']]
        points = {point['id']: point for point in visual['points']}
        for kind, duration_key, cues_key in [('story', 'duration', 'cues'), ('explanation', 'explanationDuration', 'explanationCues')]:
            identity = f'{story_id}/{kind}'
            track = tracks[story_id][kind]
            text_hash = hashlib.sha256(story[kind + 'Text'].strip().encode('utf-8')).hexdigest()
            if text_hash != track['textSha256']:
                raise ValueError(f'{identity}: text hash differs from narration metadata')
            duration = finite(track['duration'], identity + ' metadata duration')
            existing_duration = finite(story[duration_key], identity + ' catalog duration')
            if duration <= 0 or abs(existing_duration - duration) > 1e-6:
                raise ValueError(f'{identity}: duration differs from narration metadata')
            segments = track['segments']
            sequence = overrides.get((story_id, kind), visual[kind + 'Sequence'])
            if not segments or len(sequence) != len(segments):
                raise ValueError(f'{identity}: sentence-to-target map does not match segments')
            starts = [finite(segment['start'], identity + ' segment start') for segment in segments]
            if starts[0] < 0 or any(b <= a for a, b in zip(starts, starts[1:])):
                raise ValueError(f'{identity}: sentence starts must strictly increase')
            cues = []
            if starts[0] > 0:
                cues.append({'time': 0, 'end': starts[0], **INACTIVE})
            for index, (segment, point_id) in enumerate(zip(segments, sequence)):
                start = starts[index]
                next_start = starts[index + 1] if index + 1 < len(starts) else duration
                end = min(finite(segment['end'], identity + ' segment end'), next_start, duration)
                if end <= start or start >= duration:
                    raise ValueError(f'{identity}: segment ends before its active interval')
                if point_id is None:
                    target = INACTIVE
                else:
                    point = points[point_id]
                    x, y = finite(point['x'], identity + ' x'), finite(point['y'], identity + ' y')
                    if not (0 <= x <= 1 and 0 <= y <= 1):
                        raise ValueError(f'{identity}: target lies outside image')
                    target = {'x': point['x'], 'y': point['y'], 'zoom': 1, 'pointer': True, 'label': point.get('label', '')}
                # Activate this sentence's symbol immediately. Explicit end prevents
                # highlighting it through a pause, quotation, or trailing silence.
                cues.append({'time': start, 'end': end, **target})
            story[cues_key] = cues
            report['tracks'].append({'storyId': story_id, 'track': kind, 'textSha256': text_hash,
                                     'textMatches': True, 'duration': duration, 'durationMatches': True,
                                     'segments': len(segments), 'cues': len(cues), 'sourcePreserved': True})
        story['timing'] = {**story.get('timing', {}),
                           'basis': 'Existing speech-provider sentence boundaries with existing inspected targets',
                           'retiming': 'Direct active intervals; no camera zoom, interpolation, or 0.55-second target delay',
                           'wordLevelAlignment': False, 'newVisualInspection': False}
        report['stories'] += 1
    report['trackCount'] = len(report['tracks'])
    report['allTextHashesMatch'] = all(track['textMatches'] for track in report['tracks'])
    report['allDurationsMatch'] = all(track['durationMatches'] for track in report['tracks'])
    return result, report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--audio-metadata', type=Path, default=ROOT / 'production/audio-metadata.json')
    parser.add_argument('--visual-cues', type=Path, default=ROOT / 'production/visual-cues.json')
    args = parser.parse_args()
    if args.input.resolve() == args.output.resolve():
        parser.error('Use a separate output path so the live catalog remains reviewable')
    catalog, report = retime_catalog(json.loads(args.input.read_text()), json.loads(args.audio_metadata.read_text()), json.loads(args.visual_cues.read_text()))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + '\n')
    report_path = args.output.with_suffix('.report.json')
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'stories': report['stories'], 'tracks': report['trackCount'],
                      'allTextHashesMatch': report['allTextHashesMatch'], 'allDurationsMatch': report['allDurationsMatch'],
                      'output': str(args.output), 'report': str(report_path),
                      'validation': 'Supplied sentence timing only; no word-level alignment, new coordinate review, or human listening'}))


if __name__ == '__main__':
    main()
