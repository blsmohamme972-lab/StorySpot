"""Regression checks for the Drive-only APK packaging boundary."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
import zipfile

SOURCE = Path(__file__).resolve().parents[2] / "tools/build-apk.py"
SPEC = importlib.util.spec_from_file_location("storyspot_builder", SOURCE)
builder = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(builder)

class AssetPolicyTest(unittest.TestCase):
    def test_content_directories_never_stage(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            web, assets = root / "web", root / "assets"
            web.mkdir()
            for name in builder.UI_FILES:
                (web / name).write_text('{"stories": []}' if name.endswith("json") else "UI")
            for name in ["content/images/lesson.png", "content/audio/story.mp3", "content/catalog.json", "catalog.json", "old-story.mp3"]:
                target = web / name
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text("must not ship")
            (web / "fonts").mkdir()
            (web / "fonts/face.ttf").write_bytes(b"font")
            bundle = builder.stage_ui(web, assets)
            self.assertEqual(bundle["bundledStories"], 0)
            self.assertEqual(set(bundle["files"]), builder.UI_FILES | {"fonts/face.ttf"})
            self.assertFalse((assets / "content").exists())

    def test_config_rejects_nested_lesson_records(self):
        for value in [{"stories": [{"id": "x"}]}, {"nested": {"storyText": "text"}}, {"data": "data:audio/mp3;base64,xx"}]:
            with self.assertRaises(ValueError):
                builder.validate_config(value)

    def test_apk_readback_rejects_extra_media(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "test.apk"
            with zipfile.ZipFile(path, "w") as archive:
                for name in builder.UI_FILES:
                    archive.writestr("assets/" + name, json.dumps({"stories": []}) if name.endswith("json") else "UI")
                archive.writestr("assets/content/audio/story.mp3", "audio")
            with self.assertRaises(ValueError):
                builder.verify_ui_only_apk(path)

if __name__ == "__main__":
    unittest.main()
