import copy
import hashlib
import importlib.util
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('retime_catalog', ROOT / 'tools/retime_catalog.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class RetimeCatalogTests(unittest.TestCase):
    def setUp(self):
        self.catalog = {'stories': [{'id': 'stable', 'drive': {'imageId': 'image'}, 'storyText': 'Story.', 'explanationText': 'Explanation.',
                                    'duration': 4, 'explanationDuration': 4, 'storyAudio': 'same-story-url', 'explanationAudio': 'same-explanation-url',
                                    'image': 'same-image-url', 'cues': [{'time': .65, 'x': 0, 'y': 0, 'zoom': 2}]}]}
        self.audio = {'tracks': {'stable': {kind: {'duration': 4, 'textSha256': hashlib.sha256(text.encode()).hexdigest(),
                                                  'segments': [{'start': .1, 'end': 2.05}, {'start': 2, 'end': 3.5}]}
                                              for kind, text in [('story', 'Story.'), ('explanation', 'Explanation.')]}}}
        self.visuals = {'image': {'points': [{'id': 'a', 'x': .2, 'y': .8, 'zoom': 5, 'label': 'A'}, {'id': 'b', 'x': .8, 'y': .2, 'zoom': 4, 'label': 'B'}],
                                 'storySequence': ['a', 'b'], 'explanationSequence': ['b', None]}}

    def test_targets_start_with_sentence_and_stop_at_next_sentence_or_silence(self):
        original = copy.deepcopy(self.catalog)
        result, report = module.retime_catalog(self.catalog, self.audio, self.visuals, {})
        story = result['stories'][0]
        cues = story['cues']
        self.assertEqual([cue['time'] for cue in cues], [0, .1, 2])
        self.assertEqual([cue['end'] for cue in cues], [.1, 2, 3.5])
        self.assertFalse(cues[0]['pointer'])
        self.assertEqual((cues[1]['x'], cues[1]['y']), (.2, .8))
        self.assertEqual((cues[2]['x'], cues[2]['y']), (.8, .2))
        self.assertTrue(all(cue['zoom'] == 1 for cue in cues))
        self.assertEqual(story['storyAudio'], 'same-story-url')
        self.assertEqual(story['explanationAudio'], 'same-explanation-url')
        self.assertEqual(story['image'], 'same-image-url')
        self.assertEqual(story['id'], 'stable')
        self.assertEqual(self.catalog, original, 'Reviewable transformation must not mutate input')
        self.assertTrue(report['allTextHashesMatch'])
        self.assertTrue(report['allDurationsMatch'])
        self.assertFalse(story['explanationCues'][-1]['pointer'])

    def test_stale_text_cannot_reuse_audio_timing(self):
        self.catalog['stories'][0]['storyText'] = 'Changed story.'
        with self.assertRaisesRegex(ValueError, 'text hash differs'):
            module.retime_catalog(self.catalog, self.audio, self.visuals, {})

    def test_changed_duration_rejected(self):
        self.catalog['stories'][0]['duration'] = 4.2
        with self.assertRaisesRegex(ValueError, 'duration differs'):
            module.retime_catalog(self.catalog, self.audio, self.visuals, {})

    def test_unmapped_sentence_rejected(self):
        self.visuals['image']['storySequence'] = ['a']
        with self.assertRaisesRegex(ValueError, 'map does not match'):
            module.retime_catalog(self.catalog, self.audio, self.visuals, {})

    def test_invalid_sentence_interval_rejected(self):
        self.audio['tracks']['stable']['story']['segments'][0]['end'] = .05
        with self.assertRaisesRegex(ValueError, 'segment ends before'):
            module.retime_catalog(self.catalog, self.audio, self.visuals, {})

    def test_recorded_overrides_reused(self):
        overrides = module.recorded_overrides()
        self.assertEqual(overrides[('story-11', 'story')][-1], None)
        self.assertEqual(overrides[('story-1', 'story')][3:5], ['neck', 'neck'])


if __name__ == '__main__':
    unittest.main()
