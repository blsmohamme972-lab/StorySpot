"""Synthetic MCQ import fixtures; no private book text is committed."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

import openpyxl

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('import_mcqs', ROOT / 'tools/import_mcqs.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class MCQImportTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.folder = Path(self.temp.name)
        self.xlsx = self.folder / 'questions.xlsx'

    def workbook(self, rows, headers=None):
        book = openpyxl.Workbook()
        sheet = book.active
        sheet.append(headers or module.HEADERS)
        for row in rows:
            sheet.append(row)
        book.save(self.xlsx)
        return self.xlsx

    def test_extracts_all_200_questions_without_inventing_rationales(self):
        self.workbook([[f'{n}. Stem {n}', 'First', 'Second', 'Third', 'Fourth', 'Fifth', 'B. Second', None]
                       for n in range(1, 201)])
        bank = module.extract_bank(self.xlsx)
        self.assertEqual(bank['schemaVersion'], 1)
        self.assertEqual(len(bank['questions']), 200)
        self.assertEqual(bank['questions'][-1]['number'], 200)
        self.assertEqual(bank['questions'][0]['stem'], 'Stem 1')
        self.assertEqual(bank['questions'][0]['key'], 'B')
        self.assertTrue(all(not q['explanation'] and all(not o['explanation'] for o in q['options']) for q in bank['questions']))

    def test_column_labels_keep_options_and_missing_keys(self):
        self.workbook([
            ['8. Numbered stem', 'A text', 'B text', 'C text', 'D text', 'E text', 'A. A text', 'Source explanation'],
            ['11. Unresolved stem', 'A text', 'B text', 'C text', 'D text', 'E text', 'No replacement letter assigned.', None],
            ['23. Image question', None, None, None, None, None, 'A (image option)', 'Image explanation'],
        ])
        questions = module.extract_bank(self.xlsx)['questions']
        self.assertEqual([(o['label'], o['text']) for o in questions[0]['options']], [(label, label+' text') for label in 'ABCDE'])
        self.assertEqual(questions[0]['explanation'], 'Source explanation')
        self.assertIsNone(questions[1]['key'])
        self.assertIn('No replacement', questions[1]['keyNote'])
        self.assertEqual(questions[2]['key'], 'A')
        self.assertIn('figures are not included', questions[2]['keyNote'])
        self.assertTrue(all(o['text']=='' for o in questions[2]['options']))

    def test_supplied_reviewed_rationales_only(self):
        self.workbook([['7. Stem', 'First', 'Second', 'Third', 'Fourth', 'Fifth', 'A. First', None]])
        path = self.folder / 'reviewed.json'
        path.write_text(json.dumps({'7': {'correctExplanation': 'Reviewed correct rationale', 'options': {'B':'Reviewed reason B is wrong'}}}))
        question = module.extract_bank(self.xlsx, module.load_rationales(path))['questions'][0]
        self.assertEqual(question['explanation'], 'Reviewed correct rationale')
        self.assertEqual(question['options'][1]['explanation'], 'Reviewed reason B is wrong')
        self.assertEqual(question['options'][2]['explanation'], '')
        with self.assertRaisesRegex(ValueError, 'absent'):
            module.extract_bank(self.xlsx, {9:{'options':{}}})
        path.write_text(json.dumps({'7': {'options': {'F':'Invalid'}}}))
        with self.assertRaisesRegex(ValueError, 'labels'):
            module.load_rationales(path)

    def test_joins_only_explicit_numbers_many_stories_may_share_question(self):
        bank = {'questions':[{'number':7,'stem':'Seven'},{'number':1,'stem':'One'}]}
        catalog = {'stories':[
            {'id':'unrelated-without-number'},
            {'id':'clamp','drive':{'number':7}},
            {'id':'gate','number':'7'},
            {'id':'outside','number':99},
        ]}
        joined, count = module.join_catalog(catalog, bank)
        self.assertEqual(count, 2)
        self.assertNotIn('mcq', joined['stories'][0])
        self.assertNotIn('mcq', joined['stories'][3])
        self.assertEqual(joined['stories'][1]['mcq']['number'], 7)
        self.assertEqual(joined['stories'][2]['mcq']['number'], 7)
        self.assertNotIn('mcq', catalog['stories'][1])
        joined['stories'][1]['mcq']['stem']='Changed'
        self.assertEqual(joined['stories'][2]['mcq']['stem'], 'Seven')
        with self.assertRaisesRegex(ValueError, 'conflicting'):
            module.join_catalog({'stories':[{'number':1,'drive':{'number':7}}]},bank)

    def test_rejects_duplicate_numbers_bad_headers_and_empty_keyed_statement(self):
        row = ['1. Stem','First','Second','Third','Fourth','Fifth','A. First','']
        self.workbook([row, row])
        with self.assertRaisesRegex(ValueError, 'Duplicate'):
            module.extract_bank(self.xlsx)
        self.workbook([row], ['Unexpected', *module.HEADERS[1:]])
        with self.assertRaisesRegex(ValueError, 'columns'):
            module.extract_bank(self.xlsx)
        row[1]=None
        self.workbook([row])
        with self.assertRaisesRegex(ValueError, 'no statement'):
            module.extract_bank(self.xlsx)

    def test_cli_writes_bank_and_joined_catalog(self):
        self.workbook([['7. Stem','First','Second','Third','Fourth','Fifth','A. First','']])
        catalog = self.folder/'catalog.json'
        catalog.write_text(json.dumps({'stories':[{'id':'q7','number':7}]}))
        output = self.folder/'bank.json'; joined = self.folder/'joined.json'
        self.assertEqual(module.main(['--xlsx',str(self.xlsx),'--output',str(output),
                                    '--catalog',str(catalog),'--catalog-output',str(joined)]),0)
        self.assertEqual(json.loads(output.read_text())['questions'][0]['number'],7)
        self.assertEqual(json.loads(joined.read_text())['stories'][0]['mcq']['number'],7)


if __name__ == '__main__':
    unittest.main()
