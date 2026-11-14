#!/usr/bin/env python3
"""Extract source MCQs and optional reviewed rationales; never generate teaching text.

This desktop authoring tool writes outside web/. Its output is not APK input.
"""
from __future__ import annotations

import argparse
from copy import deepcopy
import json
from pathlib import Path
import re

import openpyxl

LABELS = 'ABCDE'
HEADERS = ['MCQ', *[f'Option {label}' for label in LABELS], 'Answer key', 'Explanation']


def text(value):
    return '' if value is None else str(value).strip()


def question_number(value):
    """Accept explicit integer identifiers only, never row/index guesses."""
    if isinstance(value, bool):
        raise ValueError('A question number must be a positive integer.')
    if isinstance(value, int) and value > 0:
        return value
    if isinstance(value, str) and re.fullmatch(r'[1-9][0-9]*', value.strip()):
        return int(value.strip())
    raise ValueError('A question number must be a positive integer.')


def load_rationales(path):
    if path is None:
        return {}
    value = json.loads(Path(path).read_text(encoding='utf-8'))
    if not isinstance(value, dict):
        raise ValueError('Reviewed rationales must be an object keyed by question number.')
    result = {}
    for raw_number, entry in value.items():
        number = question_number(raw_number)
        if not isinstance(entry, dict) or set(entry) - {'correctExplanation', 'options', 'reviewRequired', 'reviewNote'}:
            raise ValueError(f'Question {number}: use explanation, options, and review fields only.')
        if 'correctExplanation' in entry and not isinstance(entry['correctExplanation'], str):
            raise ValueError(f'Question {number}: correctExplanation must be text.')
        options = entry.get('options', {})
        if not isinstance(options, dict) or any(label not in LABELS or len(label) != 1 or not isinstance(rationale, str)
                                                for label, rationale in options.items()):
            raise ValueError(f'Question {number}: option rationale labels must be A–E and values must be text.')
        result[number] = entry
    return result


def extract_bank(xlsx, rationales=None):
    rationales = rationales or {}
    workbook = openpyxl.load_workbook(xlsx, data_only=True, read_only=True)
    try:
        sheet = workbook.active
        rows = sheet.iter_rows(values_only=True)
        header = next(rows, ())
        if [text(v) for v in header] != HEADERS:
            raise ValueError('Workbook columns must be: ' + ', '.join(HEADERS))
        questions, seen = [], set()
        for row_index, row in enumerate(rows, start=2):
            if not any(v is not None and text(v) for v in row):
                continue
            stem_value = text(row[0])
            match = re.fullmatch(r'([1-9][0-9]*)\.\s*(.+)', stem_value, flags=re.S)
            if not match:
                raise ValueError(f'Row {row_index}: MCQ must start with its explicit question number, for example 7. Question text.')
            number = question_number(match[1])
            if number in seen:
                raise ValueError(f'Duplicate question number {number}.')
            seen.add(number)
            key_text = text(row[6])
            key_match = re.match(r'^([A-E])(?:\.(?:\s|$)|\s*\(image option\))', key_text)
            key = key_match[1] if key_match else None
            image_option = bool(re.search(r'\(image option\)', key_text, flags=re.I))
            choices = [{'label': label, 'text': text(row[index + 1]), 'explanation': ''}
                       for index, label in enumerate(LABELS)]
            if key and not choices[LABELS.index(key)]['text'] and not image_option:
                raise ValueError(f'Question {number}: keyed option {key} has no statement; mark an image option explicitly when applicable.')
            question = {'sourceKey': key_text, 'sourceExplanation': text(row[7]), 'number': number, 'stem': match[2].strip(), 'options': choices,
                        'key': key, 'explanation': text(row[7]), 'language': 'en'}
            if not key:
                question['keyNote'] = key_text or 'Answer key not provided in the source.'
            if image_option:
                question['keyNote'] = key_text + '. The source option figures are not included in this workbook.'
            reviewed = rationales.get(number, {})
            if 'correctExplanation' in reviewed:
                question['explanation'] = reviewed['correctExplanation'].strip()
                question['explanationOrigin'] = 'AI-generated educational explanation; original source question/options/key preserved'
            if reviewed.get('reviewRequired'):
                question['reviewRequired'] = True
                question['reviewNote'] = text(reviewed.get('reviewNote'))
            for option in choices:
                if option['label'] in reviewed.get('options', {}):
                    option['explanation'] = reviewed['options'][option['label']].strip()
            questions.append(question)
        if not questions:
            raise ValueError('Workbook has no MCQs.')
        unknown = set(rationales) - seen
        if unknown:
            raise ValueError('Rationales refer to absent questions: ' + ', '.join(map(str, sorted(unknown))))
        return {'schemaVersion': 1, 'questions': questions}
    finally:
        workbook.close()


def join_catalog(catalog, bank):
    """Join by an explicit story.number or drive.number, including many-to-one matches."""
    if not isinstance(catalog, dict) or not isinstance(catalog.get('stories'), list):
        raise ValueError('Catalog must contain a stories array.')
    questions = {q['number']: q for q in bank['questions']}
    joined = deepcopy(catalog)
    matched = 0
    for story in joined['stories']:
        if not isinstance(story, dict):
            raise ValueError('Each catalog story must be an object.')
        direct = story.get('number')
        drive = story.get('drive') or {}
        if not isinstance(drive, dict):
            raise ValueError('Story drive metadata must be an object.')
        remote = drive.get('number')
        numbers = [question_number(n) for n in (direct, remote) if n is not None]
        if len(set(numbers)) > 1:
            raise ValueError(f'Story {story.get("id", "(unnamed)")} has conflicting question numbers.')
        if numbers and numbers[0] in questions:
            story['mcq'] = deepcopy(questions[numbers[0]])
            matched += 1
    return joined, matched


def write_json(path, value):
    destination = Path(path)
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--xlsx', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--rationales', type=Path, help='Reviewed text keyed by question number; no rationales are generated.')
    parser.add_argument('--catalog', type=Path)
    parser.add_argument('--catalog-output', type=Path)
    args = parser.parse_args(argv)
    if bool(args.catalog) != bool(args.catalog_output):
        parser.error('--catalog and --catalog-output must be supplied together.')
    project = Path(__file__).resolve().parents[1]
    for destination in (args.output, args.catalog_output):
        if destination and destination.resolve().is_relative_to(project / 'web'):
            parser.error('Source MCQs must not be written under web/ or bundled into the APK.')
    try:
        bank = extract_bank(args.xlsx, load_rationales(args.rationales))
        joined, matched = None, 0
        if args.catalog:
            joined, matched = join_catalog(json.loads(args.catalog.read_text(encoding='utf-8')), bank)
        # Validate all inputs before writing either artifact.
        write_json(args.output, bank)
        if joined is not None:
            write_json(args.catalog_output, joined)
        print(f'Extracted {len(bank["questions"])} MCQs. Missing explanations remain blank.')
        if joined is not None:
            print(f'Joined {matched} stories by explicit question number; no array-index matching.')
    except (ValueError, OSError, KeyError) as exc:
        parser.error(str(exc))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
