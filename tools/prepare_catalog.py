#!/usr/bin/env python3
"""Create the base StorySpot catalog from the supplied Drive text snapshot.

This intentionally preserves the supplied stories and only explains their existing
symbol mappings. Audio and visually reviewed cue enrichment is a separate step.
"""
import json
import hashlib
import re
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
AUTHORING = ROOT / 'production/remote-library'
FOLDER_URL = 'https://drive.google.com/drive/folders/1eVNE4gXZUVkd0sP7uvrTa3SvB7k2EHaT'

STORIES = [
    {
        'id': 'story-1', 'number': 1,
        'title': 'The Breathing Lantern', 'subtitle': 'A cage that protects and breathes',
        'topic': 'Thoracic cage',
        'imageId': '1t4fhYYMU4SPl_Iyw1CBDXwbPKZh_S1ZO',
        'textId': '1HaCyTojq3Qm9LIvSX0e1x9O56mc-emZ5',
        'explanationText': 'The twelve pairs of arches represent the ribs that protect the lantern. The rear column represents the thoracic vertebrae, and the front plate represents the sternum. The bellows make the chamber expand, linking protection with the changing volume of the thoracic cage during breathing. The red scarf wraps the narrow rib neck between its golden head and its projecting tubercle. Follow those three landmarks to remember the position of the neck of a typical rib.',
    },
    {
        'id': 'story-5', 'number': 5,
        'title': 'The Isolated Wagon', 'subtitle': 'A separate airway story',
        'topic': 'Pulmonary sequestration',
        'imageId': '1VyuTe-Ly_Sze7bsvwDBUP0ZYmB-to2bL',
        'textId': '1-ORxiYNEKYu_Tf0TnqX7ieBGzcCumq89',
        'explanationText': 'The mansion represents the normal lung region, and its branching copper pipes represent the tracheobronchial tree. The separate wooden wagon represents the abnormal sequestered lung segment. The locked gate and chain show that the segment does not communicate with the normal airway tree. Its position outside the mansion encodes the extralobar location. The wagon\'s own red cloak represents its separate covering of visceral pleura.',
    },
    {
        'id': 'story-7-clamp', 'number': 7,
        'title': 'The TOS Clamp', 'subtitle': 'Three cables, one tight passage',
        'topic': 'Thoracic outlet syndrome',
        'imageId': '1WizEirRSrcLTzlX0K_0SXip9oA9bQdIb',
        'textId': '1jn1j7ItzF1TMSytE3R7e3pMC8n91PC0A',
        'explanationText': 'The rusted clamp marked TOS represents compression at the thoracic outlet. The yellow cable represents neural elements, while the red and blue cables represent vascular elements. Tightening the clamp disturbs all three cables, linking the compression to a constellation of symptoms. The sparks and distressed figure reinforce that shared cause without naming individual symptoms. The hourglass marked twenty to forty is the supplied mnemonic for the more common age group.',
    },
    {
        'id': 'story-7-gate', 'number': 7,
        'title': 'The Crowded Passage', 'subtitle': 'Neurovascular structures under pressure',
        'topic': 'Thoracic outlet syndrome',
        'imageId': '1OqjYAfSzLqbqYN4hPpb-dsEcxLmlkAdJ',
        'textId': '17he5sCdp3aBGKX-plRvS-9V6xVQPhvc-',
        'explanationText': 'The tight straps around the illustrated outlet represent compression at the thoracic outlet. The yellow branching strand represents neural elements, while the red and blue vessels represent vascular elements. The enlarged inset marked TOS repeats the compressed bundle to focus attention on its location. The distressed figure and radiating sparks link this shared compression to a constellation of symptoms. The hourglass marked twenty to forty encodes the more common age group in the supplied mnemonic.',
    },
    {
        'id': 'story-9', 'number': 9,
        'title': 'The Smooth Stone', 'subtitle': 'A clue in the lower third',
        'topic': 'Oesophageal leiomyoma',
        'imageId': '1EzY4-Ad8l52gclO2WT549U-z_Fpz9_oK',
        'textId': '1yS04XPeYMmEfoZ3OCEP2cFMa5nOEroqd',
        'explanationText': 'The brass chimney represents the oesophagus, and the smooth ivory stone represents a benign leiomyoma. The stone sits in a cradle in the lower third, beside a sixty percent marker. This encodes the supplied fact that about sixty percent are in the distal third. The scale marked more than fifty percent and the dominant porcelain group encode leiomyoma as the most common benign oesophageal tumour. The student\'s crank moves the stone through an unharmed pipe, reinforcing the benign behaviour shown in the story.',
    },
    {
        'id': 'story-10', 'number': 10,
        'title': 'Weighing the Evidence', 'subtitle': 'Why the larger squares matter',
        'topic': 'Forest plots',
        'imageId': '1M6_-YXjRAlJAJno3QSNDTwWcNV5plsJ3',
        'textId': '1SWaMCqKFln1cKBl9esuc2fxh6mLbxU0s',
        'explanationText': 'The snowy forest represents a forest plot, and each glowing square lantern represents one study. The area of a square represents that study\'s weight in the meta-analysis. The larger squares pull harder on their ropes to make this weighting memorable. All ropes meet at one shared balance, representing the combination of studies. Its tilt toward the larger squares reminds you that those studies carry greater weight.',
    },
    {
        'id': 'story-11', 'number': 11,
        'title': 'Turning Back the Tide', 'subtitle': 'Drainage, relief, and a trial comparison',
        'topic': 'Pleural effusion and MARS',
        'imageId': '1T5qoSq4yoZOA4ug-bhL122eYOjGyp_5x',
        'textId': '1K1ZtYkeKFIYrMyJzpZR29NYQl1999v4V',
        'explanationText': 'The black water represents malignant pleural effusion, and the bucket represents drainage. The brass plug and sealed bucket represent preventing the fluid from returning. The clearing window and cooling red clasp encode relief of breathlessness and chest pain. The iron gate represents extrapleural pneumonectomy, abbreviated EPP. The balanced MARS scale shows the trial comparison of EPP with no EPP. The crossed-out P D versus EPP sign reinforces that this was not a randomized comparison of pleurectomy and decortication against EPP.',
    },
    {
        'id': 'story-12', 'number': 12,
        'title': 'The Silver Knot', 'subtitle': 'One knot and an uncertain path',
        'topic': 'Solitary fibrous tumour',
        'imageId': '105aNXGQGpAT_dxv-J-kfkAhW-Dw2cD64',
        'textId': '1O5rQsG8J0cOEpp0n0WCZFelmvp0zRxa7',
        'explanationText': 'The single silver knot between two coat linings represents a rare solitary fibrous tumour of the pleura. The two linings act as a metaphor for the pleural layers. The branching fibres and changing shape under the magnifying glass represent histological and morphological characteristics. The crank, moving wheel, and marble maze link those characteristics to an unpredictable clinical course. The clocks at six and seven encode the peak incidence in the sixth and seventh decades of life.',
    },
    {
        'id': 'story-13', 'number': 13,
        'title': 'The Hidden Bridge', 'subtitle': 'Bubbles reveal a vascular shortcut',
        'topic': 'Pulmonary arteriovenous malformation',
        'imageId': '1sObJNv5t89OMNARMaPDu5mxdHWkChIVY',
        'textId': '1dauzB3PpnWs4KkXak8xEE4WNDdOw_ZuU',
        'explanationText': 'The two red rivers represent a pulmonary artery and a pulmonary vein. The glowing bridge links them directly, representing an abnormal pulmonary arteriovenous connection. The surrounding wall makes that shortcut between separate routes easy to remember. The physician\'s bell placed on the chest represents transthoracic echocardiography. Bubbles crossing and lighting the bridge add the contrast component, which the supplied story identifies as its diagnostic test.',
    },
    {
        'id': 'story-14', 'number': 14,
        'title': 'The Thorned Fortress', 'subtitle': 'A patchwork mass with invasive roots',
        'topic': 'Thymic carcinoma',
        'imageId': '1nvLeofmj9DyAt-DFYo5mjBKuwqqqqwgc',
        'textId': '1RaQ3tHuPmPe8_xwXJZIsxuOdZezESoJ1',
        'explanationText': 'The fortress made of different materials represents the heterogeneous appearance of thymic carcinoma. Its thorny roots and breached walls encode an aggressive, invasive epithelial malignancy. The surgeon\'s saw and forceps represent surgical removal, the treatment emphasized in this supplied mnemonic. Removing the fortress with its roots makes that action memorable. The warm, intact house represents preserved life, while the untouched pills keep attention on the story\'s surgical theme.',
    },
    {
        'id': 'story-15', 'number': 15,
        'title': 'The Crimson Jester', 'subtitle': 'A red thread reaches distant doors',
        'topic': 'Thymic carcinoid tumour',
        'imageId': '1DKA0uAyArkwfG2H02XV-UPyw-fY7J5XB',
        'textId': '1W9KF9VOQ1UYOLDYZyXoJ4AJuHa5yMQm3',
        'explanationText': 'The small house shaped like a reliquary represents the thymus gland. The crimson and gold masked jester inside represents a thymic carcinoid tumour. Matching jesters in distant doorways encode histological similarity to carcinoid tumours at other sites. The red thread and falling dominoes represent the common spread described in the supplied story. The scholar\'s failed attempt to stop that chain reinforces the same theme of metastasis.',
    },
]


def arabic_story(text):
    text = re.split(r'\n\s*(?:GPT note|Note for GPT|GPT SYMBOLS AND MEANINGS)', text, maxsplit=1)[0]
    return ''.join(ch for ch in text if unicodedata.category(ch) != 'Cf').strip()


def main():
    records = {entry['id']: entry for entry in json.loads((ROOT / 'production/drive-snapshot.json').read_text())}
    stories = []
    for entry in STORIES:
        entry = dict(entry)
        image = records[entry.pop('imageId')]
        text = records[entry.pop('textId')]
        entry.update({
            'image': f"content/images/{image['id']}.png",
            'storyText': arabic_story(text['content']),
            'storyLanguage': 'ar',
            'explanationLanguage': 'en',
            'drive': {
                'imageId': image['id'], 'textId': text['id'],
                'number': entry['number'],
                'imageSha256': hashlib.sha256((AUTHORING / f"content/images/{image['id']}.png").read_bytes()).hexdigest(),
                'originalName': image['title'], 'textOriginalName': text['title'],
                'imageModifiedTime': image.get('modified_time'),
                'textModifiedTime': text.get('modified_time'),
            },
            'source': 'User-supplied mnemonic image and story from Google Drive. Symbol explanation adapted from the supplied notes; not independently source-verified.',
        })
        stories.append(entry)
    catalog = {
        'schemaVersion': 1,
        'name': 'StorySpot',
        'description': 'Arabic stories. English explanations. Visual memory in motion.',
        'folderUrl': FOLDER_URL,
        'generatedAt': '2026-11-09T16:45:00Z',
        'source': {
            'type': 'user-supplied-google-drive-folder',
            'folderId': '1eVNE4gXZUVkd0sP7uvrTa3SvB7k2EHaT',
            'folderUrl': FOLDER_URL,
            'note': 'Mnemonic stories and artwork supplied by the user. Medical claims and literary quotations have not been independently source-verified.',
        },
        'stories': stories,
    }
    target = AUTHORING / 'catalog-source.json'
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + '\n')
    print(f'Wrote {len(stories)} stories to {target}')


if __name__ == '__main__':
    main()
