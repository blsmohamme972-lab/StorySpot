"""Remote-only Drive library regression tests; no initial lesson/media fixtures."""
import json
import os
from pathlib import Path
import shutil
import unittest
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]


class DriveSyncTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.playwright = sync_playwright().start()
        browser_path = os.environ.get('CHROMIUM_PATH') or shutil.which('chromium') or shutil.which('chromium-browser')
        cls.browser = cls.playwright.chromium.launch(executable_path=browser_path, args=['--no-sandbox'])

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.playwright.stop()

    def setUp(self):
        self.page = self.browser.new_page()
        self.page.route('http://storyspot.test/**', lambda route: route.fulfill(body='<!doctype html><html></html>', content_type='text/html'))
        self.page.goto('http://storyspot.test/')
        self.page.evaluate("""() => {
          const file=(id,name,mime='text/plain',modifiedTime=100)=>({id,name,mime,modifiedTime,size:20});
          const rootId='1eVNE4gXZUVkd0sP7uvrTa3SvB7k2EHaT';
          window.fixture={rootId,offline:false,texts:{},folders:{},registry:{},registrations:[],downloads:0,extraEmbedded:[]};
          fixture.folders[rootId]=[
            file('image_moon_001','moon.png','image/png'), file('text_moon_001','moon.txt'),
            file('audio_moon_001','moon.mp3','audio/mpeg'), file('audio_explain_001','moon-explanation.mp3','audio/mpeg'),
            file('image_7clamp_01','7.png','image/png'), file('image_7gate_002','7.png','image/png'),
            file('text_7clamp_01','story-image-7.txt'), file('text_7gate_002','story-image-7.txt'),
            file('image_alone_01','waterfall.jpg','image/jpeg'),
            file('manifest_library1','catalog.json','application/json',1000),
            file('folder_lesson_01','A new lesson','application/vnd.google-apps.folder')
          ];
          fixture.folders.folder_lesson_01=[file('image_mars_001','mars.png','image/png'),file('text_mars_001','mars.txt')];
          Object.assign(fixture.texts,{
            text_moon_001:'قصة القمر.\\n\\nGPT note (English): Moon symbol.',
            text_7clamp_01:'قصة المشبك.', text_7gate_002:'قصة البوابة.',text_mars_001:'قصة المريخ.'
          });
          fixture.manifest={stories:[
            {id:'moon',title:'The Moon',image:'image_moon_001',storyText:'قصة القمر.',explanationText:'The moon is a symbol.',
             cues:[{time:0,x:.5,y:.5,zoom:1,pointer:false}],drive:{imageId:'image_moon_001',textId:'text_moon_001'}},
            {id:'clamp',title:'Clamp',image:'image_7clamp_01',drive:{imageId:'image_7clamp_01',textId:'text_7clamp_01'}},
            {id:'gate',title:'Gate',image:'image_7gate_002',drive:{imageId:'image_7gate_002',textId:'text_7gate_002'}}
          ]};
          fixture.html=files=>{
            const records=files.map(f=>[f.id,[],f.name,f.mime,0,null,0,0,0,50,f.modifiedTime,null,null,f.size]);
            const json=JSON.stringify([records,null,null,null,[]]);
            const escaped=json.replace(/\\\\/g,'\\\\\\\\').replace(/'/g,"\\\\'");
            return `<script>window['_DRIVE_ivd'] = '${escaped}'; window.UNTRUSTED_EXECUTED=true;</script>`;
          };
          window.statuses=[];window.received=[];
          window.onNativeStatus=s=>statuses.push(s); window.onNativeCatalog=v=>received.push(v);
          window.StorySpotNative={
            fetchText(id,url){queueMicrotask(()=>{
              if(fixture.offline)return onNativeResponse({id,ok:false,error:'Offline'});
              const u=new URL(url), fileId=u.searchParams.get('id');
              const folderId=u.pathname.match(/\\/folders\\/([^/]+)/)?.[1];
              const embeddedId=u.pathname==='/embeddedfolderview'?u.searchParams.get('id'):null;
              let text=embeddedId?fixture.html([...(fixture.folders[embeddedId]||[]),...(embeddedId===fixture.rootId?fixture.extraEmbedded:[])]):folderId?fixture.html(fixture.folders[folderId]||[]):
                fileId==='manifest_library1'?JSON.stringify(fixture.manifest):fixture.texts[fileId];
              if(text===undefined)return onNativeResponse({id,ok:false,error:'Missing fixture text'});
              onNativeResponse({id,ok:true,text});
            });},
            registerMedia(url,revision){
              const key=url+'\\n'+revision;fixture.registrations.push({url,revision});
              return fixture.registry[key]||(fixture.registry[key]='https://appassets.androidplatform.net/remote/media_'+Object.keys(fixture.registry).length);
            },
            cacheMedia(){fixture.downloads++;throw Error('Eager download is forbidden in this test');},
            getItem:key=>localStorage.getItem(key),setItem:(key,value)=>localStorage.setItem(key,value)
          };
        }""")
        self.page.add_script_tag(path=str(ROOT/'web/drive-sync.js'))
        self.page.evaluate("window.initial=StorySpotSync.init({name:'StorySpot',stories:[{id:'forbidden-bundled'}]})")

    def tearDown(self):
        self.page.close()

    def sync(self):
        self.page.evaluate('StorySpotSync.sync()')
        return self.page.evaluate('({received,statuses,downloads:fixture.downloads})')

    def test_boot_is_empty_and_first_sync_discovers_manifest_plus_unlisted_images(self):
        self.assertEqual(self.page.evaluate('initial.stories'),[])
        result=self.sync()
        self.assertEqual(result['statuses'][-1]['state'],'success')
        stories=result['received'][-1]['stories']
        self.assertEqual(len(stories),5)
        self.assertEqual({s['drive']['imageId'] for s in stories},{'image_moon_001','image_7clamp_01','image_7gate_002','image_alone_01','image_mars_001'})
        self.assertEqual(result['downloads'],0)
        self.assertFalse(self.page.evaluate('!!window.UNTRUSTED_EXECUTED'))
        moon=next(s for s in stories if s['id']=='moon')
        self.assertEqual(moon['title'],'The Moon')
        self.assertEqual(moon['cues'][0]['pointer'],False)
        self.assertIn('storyAudio',moon)
        self.assertIn('explanationAudio',moon)
        standalone=next(s for s in stories if s['drive']['imageId']=='image_alone_01')
        self.assertEqual(standalone['storyText'],'')
        self.assertNotIn('storyAudio',standalone)

    def test_recorded_quote_interval_survives_sync_and_invalidates_with_text(self):
        self.page.evaluate("fixture.manifest.stories[0].quote={text:'قصة القمر',start:3,end:5}")
        self.page.evaluate("StorySpotSync.sync()")
        quote = self.page.evaluate("received.at(-1).stories.find(s=>s.id==='moon').quote")
        self.assertEqual(quote, {'text':'قصة القمر','start':3,'end':5})
        self.page.evaluate("fixture.texts.text_moon_001='قصة مختلفة.'")
        self.page.evaluate("StorySpotSync.sync()")
        self.assertFalse(self.page.evaluate("!!received.at(-1).stories.find(s=>s.id==='moon').quote"))

    def test_adding_any_image_appears_without_changing_manifest_or_apk(self):
        self.sync()
        self.page.evaluate("fixture.folders[fixture.rootId].push({id:'image_new_pear1',name:'pear.png',mime:'image/png',modifiedTime:200,size:10})")
        result=self.sync()
        self.assertEqual(len(result['received'][-1]['stories']),6)
        self.assertTrue(any(s['drive']['imageId']=='image_new_pear1' for s in result['received'][-1]['stories']))

    def test_embedded_view_adds_images_missing_from_main_initial_listing(self):
        self.page.evaluate("fixture.extraEmbedded.push({id:'image_extra_0001',name:'extra.png',mime:'image/png',modifiedTime:200,size:10})")
        stories=self.sync()['received'][-1]['stories']
        self.assertTrue(any(s['drive']['imageId']=='image_extra_0001' for s in stories))

    def test_without_manifest_duplicate_images_both_appear_without_guessed_text(self):
        self.page.evaluate("fixture.folders[fixture.rootId]=fixture.folders[fixture.rootId].filter(f=>f.id!=='manifest_library1')")
        stories=self.sync()['received'][-1]['stories']
        duplicates=[s for s in stories if s['drive']['imageId'] in ['image_7clamp_01','image_7gate_002']]
        self.assertEqual(len(duplicates),2)
        self.assertTrue(all(s['storyText']=='' for s in duplicates))
        self.assertEqual(len({s['id'] for s in duplicates}),2)

    def test_manifest_disambiguates_exact_image_and_text_ids(self):
        stories=self.sync()['received'][-1]['stories']
        self.assertEqual(next(s for s in stories if s['id']=='clamp')['storyText'],'قصة المشبك.')
        self.assertEqual(next(s for s in stories if s['id']=='gate')['storyText'],'قصة البوابة.')

    def test_offline_failure_preserves_completed_library(self):
        self.sync();self.page.evaluate('fixture.offline=true')
        result=self.sync()
        self.assertEqual(len(result['received']),1)
        self.assertEqual(result['statuses'][-1]['state'],'error')

    def test_legacy_packaged_paths_cannot_return_at_boot(self):
        self.page.evaluate("""localStorage.setItem('storyspot.drive.catalog.v2',JSON.stringify({remoteOnly:true,stories:[
          {id:'legacy',image:'content/images/old.png',drive:{imageId:'legacy_image001'}}
        ]}))""")
        result=self.page.evaluate('StorySpotSync.init({stories:[{id:"old"}]})')
        self.assertEqual(result['stories'],[])

    def test_completed_remote_cache_survives_restart_without_callbacks(self):
        self.sync()
        self.page.evaluate('received.length=0')
        result=self.page.evaluate('StorySpotSync.init({})')
        self.assertEqual(len(result['stories']),5)
        self.assertEqual(self.page.evaluate('received.length'),0)

    def test_changed_text_invalidates_old_narration_and_timing(self):
        self.sync();self.page.evaluate("fixture.texts.text_moon_001='قصة جديدة.'")
        moon=next(s for s in self.sync()['received'][-1]['stories'] if s['id']=='moon')
        self.assertNotIn('storyAudio',moon)
        self.assertNotIn('explanationAudio',moon)
        self.assertEqual(moon['cues'],[])

    def test_changed_image_revision_invalidates_old_cues(self):
        self.sync()
        self.page.evaluate("fixture.folders[fixture.rootId].find(f=>f.id==='image_moon_001').modifiedTime=2000")
        moon=next(s for s in self.sync()['received'][-1]['stories'] if s['id']=='moon')
        self.assertEqual(moon['cues'],[])

    def test_unchanged_versions_reuse_lazy_media_registry(self):
        self.sync();before=self.page.evaluate('Object.keys(fixture.registry).length')
        self.sync();after=self.page.evaluate('Object.keys(fixture.registry).length')
        self.assertEqual(before,after)

    def test_manual_sync_preserves_known_media_and_only_updates_changed_file(self):
        before = self.sync()['received'][-1]['stories']
        count = self.page.evaluate('Object.keys(fixture.registry).length')
        self.page.evaluate('StorySpotSync.sync({force:true})')
        after = self.page.evaluate('received.at(-1).stories')
        for first, second in zip(before, after):
            for key in ['image', 'storyAudio', 'explanationAudio']:
                self.assertEqual(first.get(key), second.get(key))
        self.assertEqual(count, self.page.evaluate('Object.keys(fixture.registry).length'))
        self.page.evaluate("fixture.folders[fixture.rootId].find(f=>f.id==='audio_moon_001').modifiedTime=2000")
        updated = next(s for s in self.sync()['received'][-1]['stories'] if s['id']=='moon')
        moon = next(s for s in before if s['id']=='moon')
        self.assertEqual(moon['image'], updated['image'])
        self.assertEqual(moon['explanationAudio'], updated['explanationAudio'])
        self.assertNotEqual(moon['storyAudio'], updated['storyAudio'])

    def test_unversioned_media_survives_auto_refresh_and_manual_retry_is_sticky(self):
        self.page.evaluate("fixture.folders[fixture.rootId].find(f=>f.id==='image_alone_01').modifiedTime=null")
        def image():
            return self.page.evaluate("received.at(-1).stories.find(s=>s.drive.imageId==='image_alone_01').image")
        self.sync(); initial = image()
        self.sync(); self.assertEqual(image(), initial)
        self.page.evaluate('StorySpotSync.sync({force:true})')
        retried = image()
        self.assertNotEqual(retried, initial)
        self.sync(); self.assertEqual(image(), retried)
        self.page.evaluate('StorySpotSync.init({})')
        self.sync(); self.assertEqual(image(), retried)

    def test_malformed_embedded_marker_cannot_erase_completed_library(self):
        self.sync()
        self.page.evaluate("fixture.html=()=>`<script>window['_DRIVE_ivd'] = 'broken-json';</script>`")
        result = self.sync()
        self.assertEqual(len(result['received']), 1)
        self.assertEqual(result['statuses'][-1]['state'], 'error')
        self.assertEqual(len(self.page.evaluate('StorySpotSync.init({}).stories')), 5)

    def test_partial_listing_keeps_absent_cached_stories_and_discovers_additions(self):
        self.sync()
        self.page.evaluate("""() => {
          fixture.folders[fixture.rootId]=fixture.folders[fixture.rootId].filter(f=>f.id!=='image_alone_01');
          fixture.folders[fixture.rootId].push({id:'image_new_pear1',name:'pear.png',mime:'image/png',modifiedTime:200,size:10});
          const original=StorySpotNative.fetchText;
          StorySpotNative.fetchText=(id,url)=>url.includes('/embeddedfolderview')?
            queueMicrotask(()=>onNativeResponse({id,ok:false,error:'Temporary failure'})):original(id,url);
        }""")
        result = self.sync()
        stories = result['received'][-1]['stories']
        self.assertEqual(len(stories), 6)
        self.assertTrue(any(s['drive']['imageId']=='image_alone_01' for s in stories))
        self.assertTrue(any(s['drive']['imageId']=='image_new_pear1' for s in stories))
        self.assertIn('partial listing', result['statuses'][-1]['message'])

    def test_partial_listing_cannot_replace_enriched_stories_with_bare_images(self):
        self.sync()
        first = self.page.evaluate('JSON.parse(JSON.stringify(received.at(-1)))')
        self.page.evaluate("""() => {
          fixture.folders[fixture.rootId]=fixture.folders[fixture.rootId].filter(f=>f.id!=='manifest_library1');
          const original=StorySpotNative.fetchText;
          StorySpotNative.fetchText=(id,url)=>url.includes('/embeddedfolderview')?
            queueMicrotask(()=>onNativeResponse({id,ok:false,error:'Temporary failure'})):original(id,url);
        }""")
        result = self.sync()
        self.assertEqual(len(result['received']), 1)
        self.assertEqual(result['statuses'][-1]['state'], 'error')
        self.assertEqual(self.page.evaluate('StorySpotSync.init({})'), first)

    def test_partial_listing_cannot_strip_optional_files_from_existing_story(self):
        self.page.evaluate("fixture.folders[fixture.rootId]=fixture.folders[fixture.rootId].filter(f=>f.id!=='manifest_library1')")
        self.sync()
        first = self.page.evaluate('JSON.parse(JSON.stringify(received.at(-1)))')
        self.page.evaluate("""() => {
          fixture.folders[fixture.rootId]=fixture.folders[fixture.rootId].filter(f=>f.id!=='audio_moon_001');
          const original=StorySpotNative.fetchText;
          StorySpotNative.fetchText=(id,url)=>url.includes('/embeddedfolderview')?
            queueMicrotask(()=>onNativeResponse({id,ok:false,error:'Temporary failure'})):original(id,url);
        }""")
        result = self.sync()
        self.assertEqual(len(result['received']), 1)
        self.assertEqual(result['statuses'][-1]['state'], 'error')
        self.assertEqual(self.page.evaluate('StorySpotSync.init({})'), first)

    def test_duplicate_html_entries_keep_embedded_mime_and_revision_fields(self):
        self.page.evaluate("""() => {
          const original=StorySpotNative.fetchText;
          StorySpotNative.fetchText=(id,url)=>url.includes('/folders/')?
            queueMicrotask(()=>onNativeResponse({id,ok:true,text:fixture.folders[fixture.rootId].map(f=>
              `<tr data-selectable data-id="${f.id}"><td><strong>${f.name}</strong></td></tr>`).join('')})):
            original(id,url);
        }""")
        result = self.sync()
        stories = result['received'][-1]['stories']
        self.assertTrue(any(s['drive']['imageId']=='image_mars_001' for s in stories))
        self.assertEqual(next(s for s in stories if s['id']=='moon')['drive']['imageVersion'], '100:20')

    def test_valid_empty_library_is_distinct_from_malformed_response(self):
        self.sync()
        self.page.evaluate('fixture.folders[fixture.rootId]=[]; fixture.extraEmbedded=[]')
        result = self.sync()
        self.assertEqual(result['statuses'][-1]['state'], 'success')
        self.assertEqual(result['received'][-1]['stories'], [])

    def test_sidecar_failure_keeps_entire_completed_catalog(self):
        self.sync()
        first = self.page.evaluate('JSON.parse(JSON.stringify(received.at(-1)))')
        self.page.evaluate('delete fixture.texts.text_mars_001')
        result = self.sync()
        self.assertEqual(len(result['received']), 1)
        self.assertEqual(result['statuses'][-1]['state'], 'error')
        self.assertEqual(self.page.evaluate('StorySpotSync.init({})'), first)

    def test_parallel_text_reads_keep_folder_order_and_bounded_request_count(self):
        self.page.evaluate("""() => {
          const original=StorySpotNative.fetchText;
          fixture.active=0; fixture.peak=0;
          StorySpotNative.fetchText=(id,url)=>{
            if(url.includes('/folders/')||url.includes('/embeddedfolderview'))return original(id,url);
            fixture.active++; fixture.peak=Math.max(fixture.active,fixture.peak);
            setTimeout(()=>{fixture.active--;original(id,url);},20);
          };
        }""")
        stories = self.sync()['received'][-1]['stories']
        self.assertEqual([s['id'] for s in stories], ['moon','clamp','gate','drive-image_alone_01','drive-image_mars_001'])
        peak = self.page.evaluate('fixture.peak')
        self.assertGreater(peak, 1)
        self.assertLessEqual(peak, 3)

    def test_hostile_manifest_does_not_replace_current_library(self):
        self.sync();self.page.evaluate("fixture.manifest.stories[0].image='javascript:alert(1)'")
        result=self.sync()
        self.assertEqual(len(result['received']),1)
        self.assertEqual(result['statuses'][-1]['state'],'error')

    def test_only_newer_sidecar_timing_can_restore_updated_image_focus(self):
        self.sync()
        self.page.evaluate("""() => {
            fixture.folders[fixture.rootId].find(f=>f.id==='image_moon_001').modifiedTime=2000;
            fixture.folders[fixture.rootId].push({id:'timing_moon_001',name:'moon-timing.json',mime:'application/json',modifiedTime:100,size:10});
            fixture.texts.timing_moon_001=JSON.stringify({cues:[{time:1,x:.2,y:.3}]});
        }""")
        moon=next(s for s in self.sync()['received'][-1]['stories'] if s['id']=='moon')
        self.assertEqual(moon['cues'],[])
        self.page.evaluate("fixture.folders[fixture.rootId].find(f=>f.id==='timing_moon_001').modifiedTime=3000")
        moon=next(s for s in self.sync()['received'][-1]['stories'] if s['id']=='moon')
        self.assertEqual(moon['cues'][0]['time'],1)
        self.assertFalse(moon.get('needsTiming'))

    def test_multiple_books_keep_independent_ids_and_offline_catalogs(self):
        original = self.sync()['received'][-1]
        book = self.page.evaluate("StorySpotSync.addBook('Second book','https://drive.google.com/drive/folders/second_book_001?usp=sharing')")
        self.page.evaluate("fixture.folders.second_book_001=fixture.folders[fixture.rootId].filter(f=>f.id==='image_moon_001'||f.id==='manifest_library1')")
        opened = self.page.evaluate('(id)=>StorySpotSync.selectBook(id)', book['id'])
        self.assertEqual(opened['stories'], [])
        second = self.sync()['received'][-1]
        self.assertEqual(second['bookId'],book['id'])
        self.assertEqual(next(s for s in second['stories'] if s['drive']['imageId']=='image_moon_001')['id'],book['id']+':moon')
        self.assertEqual(self.page.evaluate('StorySpotSync.init({}).bookId'),book['id'])
        first = self.page.evaluate('(id)=>StorySpotSync.selectBook(id)', original['bookId'])
        self.assertEqual([(s['id'],s['image'],s['storyText']) for s in first['stories']],
                         [(s['id'],s['image'],s['storyText']) for s in original['stories']])
        self.assertEqual(self.page.evaluate('StorySpotSync.listBooks().length'),2)
        # Duplicate links do not make copies or discard the existing cache.
        self.page.evaluate("StorySpotSync.addBook('Duplicate','https://drive.google.com/drive/folders/second_book_001')")
        self.assertEqual(self.page.evaluate('StorySpotSync.listBooks().length'),2)

    def test_book_folder_validation_and_returned_objects_are_isolated(self):
        for url in ['https://evil.example/drive/folders/second_book_001','javascript:alert(1)',
                    'https://drive.google.com/file/d/second_book_001/view']:
            result=self.page.evaluate("url=>{try{StorySpotSync.addBook('Bad',url);return false}catch{return true}}",url)
            self.assertTrue(result)
        self.page.evaluate("StorySpotSync.listBooks()[0].folderUrl='https://evil.example'")
        self.assertEqual(self.page.evaluate('StorySpotSync.folderUrl'),
                         'https://drive.google.com/drive/folders/1eVNE4gXZUVkd0sP7uvrTa3SvB7k2EHaT')

    def test_old_book_sync_response_cannot_replace_new_selection(self):
        self.page.evaluate("""() => {
            const fetch=StorySpotNative.fetchText;
            fixture.held=[];
            StorySpotNative.fetchText=(id,url)=>fixture.held.push(()=>fetch(id,url));
            window.oldSync=StorySpotSync.sync();
            const book=StorySpotSync.addBook('Second book','https://drive.google.com/drive/folders/second_book_001');
            StorySpotSync.selectBook(book.id);
            StorySpotNative.fetchText=fetch;
            fixture.held.forEach(fn=>fn());
        }""")
        self.page.evaluate('window.oldSync')
        self.assertEqual(self.page.evaluate('received.length'),1)
        self.assertEqual(self.page.evaluate('received[0].stories.length'),0)
        self.assertEqual(self.page.evaluate('statuses.at(-1).state'),'idle')

    def test_mcq_manifest_audio_and_segment_cues_survive_sync(self):
        self.page.evaluate("""() => {
            Object.assign(fixture.manifest.stories[0],{
                mcq:{stem:'Example question?',options:[{label:'A',text:'First',explanation:'Provided rationale'}],key:'A',language:'en'},
                mcqAudio:'audio_mcq_001',mcqDuration:12,
                mcqCues:[{time:2,end:4,x:.3,y:.4,segmentId:'stem',pointer:true}]
            });
        }""")
        moon=next(s for s in self.sync()['received'][-1]['stories'] if s['id']=='moon')
        self.assertEqual(moon['mcq']['key'],'A')
        self.assertEqual(moon['mcqCues'][0]['end'],4)
        self.assertEqual(moon['mcqCues'][0]['segmentId'],'stem')
        self.assertIn('/remote/',moon['mcqAudio'])
        self.assertEqual(moon['mcqDuration'],12)

    def test_mcq_json_and_audio_sidecars_are_matched_by_image(self):
        self.page.evaluate("""() => {
          fixture.folders[fixture.rootId].push(
            {id:'mcq_moon_data1',name:'moon-mcq.json',mime:'application/json',modifiedTime:100,size:10},
            {id:'audio_mcq_001',name:'moon-mcq.mp3',mime:'audio/mpeg',modifiedTime:100,size:10});
          fixture.texts.mcq_moon_data1=JSON.stringify({stem:'Sidecar question?',options:[],key:'A'});
        }""")
        moon=next(s for s in self.sync()['received'][-1]['stories'] if s['id']=='moon')
        self.assertEqual(moon['mcq']['stem'],'Sidecar question?')
        self.assertIn('/remote/',moon['mcqAudio'])

if __name__=='__main__':unittest.main()
