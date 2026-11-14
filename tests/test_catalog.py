"""Verify the thin APK contains no lessons and preserved remote assets are intact."""
import hashlib
import json
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[1]
REMOTE = ROOT / 'production/remote-library'


class CatalogIntegrity(unittest.TestCase):
    def test_apk_web_assets_contain_no_lessons(self):
        web = ROOT / 'web'
        forbidden = {'.png', '.jpg', '.jpeg', '.webp', '.gif', '.mp3', '.m4a', '.wav', '.ogg', '.aac', '.mp4'}
        media = [p.relative_to(web).as_posix() for p in web.rglob('*') if p.is_file() and p.suffix.lower() in forbidden]
        self.assertEqual(media, [], 'Drive lesson media must not be embedded in the APK web assets')
        # An empty configuration catalog is harmless; a collection belongs in Drive.
        catalog_path = web / 'content/catalog.json'
        if catalog_path.exists():
            self.assertEqual(json.loads(catalog_path.read_text()).get('stories', []), [])
        for path in web.rglob('*.json'):
            data = json.loads(path.read_text())
            if isinstance(data, dict):
                self.assertFalse(data.get('stories'), f'Embedded lesson records found in {path}')

    def test_preserved_remote_authoring_integrity(self):
        catalog = json.loads((REMOTE / 'catalog-source.json').read_text())
        audio = json.loads((ROOT / 'production/audio-metadata.json').read_text())['tracks']
        visuals = json.loads((ROOT / 'production/visual-cues.json').read_text())
        self.assertEqual(len(catalog['stories']), 11)
        self.assertEqual(len({s['id'] for s in catalog['stories']}), 11)
        for story in catalog['stories']:
            with self.subTest(story=story['id']):
                self.assertTrue(re.search('[\u0600-\u06ff]', story['storyText']))
                self.assertFalse(re.search('[\u0600-\u06ff]', story['explanationText']))
                self.assertNotRegex(story['storyText'], r'(?i)(GPT note|Note for GPT|GPT SYMBOLS)')
                image = REMOTE / story['image']
                self.assertEqual(hashlib.sha256(image.read_bytes()).hexdigest(), story['drive']['imageSha256'])
                self.assertEqual(visuals[story['drive']['imageId']]['inspection']['status'], 'inspected')
                for kind, media_key, duration_key, cue_key in [
                    ('story', 'storyAudio', 'duration', 'cues'),
                    ('explanation', 'explanationAudio', 'explanationDuration', 'explanationCues'),
                ]:
                    track = audio[story['id']][kind]
                    data = (REMOTE / story[media_key]).read_bytes()
                    self.assertEqual(hashlib.sha256(data).hexdigest(), track['sha256'])
                    self.assertEqual(hashlib.sha256(story[kind + 'Text'].strip().encode()).hexdigest(), track['textSha256'])
                    self.assertEqual(story[duration_key], track['duration'])
                    self.assertGreater(track['duration'], 10)
                    cues = story[cue_key]
                    self.assertGreater(len(cues), 4)
                    self.assertEqual(cues[0]['time'], 0)
                    self.assertLessEqual(cues[-1]['time'], track['duration'])
                    self.assertTrue(all(c.get('end', track['duration']) <= track['duration'] for c in cues))
                    self.assertTrue(all(c.get('end', c['time']) >= c['time'] for c in cues))
                    self.assertEqual([c['time'] for c in cues], sorted(c['time'] for c in cues))
                    for cue in cues:
                        self.assertTrue(0 <= cue['x'] <= 1 and 0 <= cue['y'] <= 1)
                        self.assertTrue(1 <= cue['zoom'] <= 2)
                        self.assertFalse(re.search('[\u0600-\u06ff]', cue['label']))
                    for segment in track['segments']:
                        self.assertTrue(0 <= segment['start'] < segment['end'] <= track['duration'])
                self.assertTrue(story['narration']['synthetic'])

    def test_remote_manifest_preserves_stories_and_uses_drive_media(self):
        source = json.loads((REMOTE / 'catalog-source.json').read_text())
        manifest = json.loads((REMOTE / 'catalog.json').read_text())
        self.assertEqual([s['id'] for s in manifest['stories']], [s['id'] for s in source['stories']])
        for original, remote in zip(source['stories'], manifest['stories']):
            with self.subTest(story=remote['id']):
                for field in ['storyText', 'explanationText', 'cues', 'explanationCues']:
                    self.assertEqual(remote[field], original[field])
                for field in ['image', 'storyAudio', 'explanationAudio']:
                    self.assertRegex(remote[field], r'^(?:[A-Za-z0-9_-]{10,}|https://(?:drive\.google\.com|drive\.usercontent\.google\.com)/.*)$')
                    self.assertFalse(remote[field].startswith('content/'))


if __name__ == '__main__':
    unittest.main()
