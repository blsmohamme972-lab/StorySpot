/* Library refresh and navigation must keep rendered metadata and filtering coherent. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const web = path.resolve(__dirname, '../web');
const server = http.createServer((req, res) => {
  const filename = path.resolve(web, '.' + (req.url === '/' ? '/index.html' : req.url.split('?')[0]));
  if (!filename.startsWith(web + path.sep)) return res.writeHead(403).end();
  fs.readFile(filename, (error, bytes) => {
    if (error) return res.writeHead(404).end();
    res.setHeader('Content-Type', filename.endsWith('.js') ? 'text/javascript' : filename.endsWith('.html') ? 'text/html' : filename.endsWith('.css') ? 'text/css' : 'application/octet-stream');
    res.end(bytes);
  });
});
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox']});
  const context = await browser.newContext({viewport:{width:390,height:844}});
  const page = await context.newPage(), errors = [], failures = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/drive-sync.js', route => route.fulfill({contentType:'text/javascript', body:`
    const book={id:'fixture-book',name:'Fixture book'};let cached;
    window.StorySpotSync={init:c=>(cached=c),useCatalog:c=>(cached=c),sync:async()=>{},listBooks:()=>[book],currentBook:()=>book,
      selectBook:id=>cached};`}));
  await page.addInitScript(() => {
    window.__speech=[];
    window.StorySpotNative={ready(){},getItem:()=>'',setItem(){},setPlaybackActive(){},speakMcq(id,text){__speech.push({id,text});},stopMcq(){}};
  });
  const check = async (label, action) => {try {await action();} catch(error) {failures.push(label+': '+error.message);}};
  try {
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.waitForFunction(() => window.StorySpot?.state.booted);
    await page.evaluate(() => {
      const image='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>');
      const mcq={stem:'Which option?',key:'B',options:[{label:'A',text:'First'},{label:'B',text:'Second'}],explanation:'A rationale.'};
      window.__one={id:'first',title:'First story',category:'OLD CATEGORY',image,imageAlt:'Old description',mcq};
      window.__two={id:'second',title:'Second story',image,mcq};
      StorySpot.loadCatalog({bookId:'fixture-book',stories:[__one]});
    });
    assert.equal(await page.locator('#nextButton').isDisabled(), true);
    await page.evaluate(() => StorySpot.loadCatalog({bookId:'fixture-book',stories:[{...__one,category:'NEW CATEGORY',imageAlt:'New description',cues:[{time:0,x:.2,y:.3}]},__two]}));
    await check('Next enabled after addition', async () => assert.equal(await page.locator('#nextButton').isDisabled(), false));
    await check('Category refreshed', async () => assert.equal(await page.locator('#storyCategory').textContent(), 'NEW CATEGORY'));
    await check('Image accessibility text refreshed', async () => assert.equal(await page.locator('#storyImage').getAttribute('alt'), 'New description'));
    await check('Timing availability refreshed', async () => assert.doesNotMatch(await page.locator('#assetStatus').textContent(), /Timing needed/));
    await page.evaluate(() => {
      StorySpot.stop();StorySpot.loadCatalog({bookId:'fixture-book',stories:[__one,__two]});
      document.getElementById('saveButton').click();document.getElementById('savedTab').click();
    });
    assert.equal(await page.evaluate(() => StorySpot.state.visible.length), 1);
    await context.setOffline(true);
    await page.evaluate(() => StorySpotBooks.choose('fixture-book'));
    await check('Same-book selection restores Discover offline', async () => {
      assert.equal(await page.evaluate(() => StorySpot.state.savedOnly), false);
      assert.equal(await page.evaluate(() => StorySpot.state.visible.length), 2);
    });
    await context.setOffline(false);
    await page.evaluate(() => {
      StorySpot.stop();StorySpot.state.savedOnly=false;
      StorySpot.loadCatalog({bookId:'fixture-book',stories:[__one,__two]});
      StorySpot.selectTrack('mcq');StorySpot.togglePlay();
      onMCQSpeech({id:__speech.at(-1).id,state:'start'});
      StorySpot.loadCatalog({bookId:'fixture-book',stories:[{...__one,title:'First updated'}]});
      StorySpot.move(1);
    });
    await check('One remaining story retains play intent after navigation', async () => {
      assert.equal(await page.evaluate(() => StorySpot.state.visible.length), 1);
      assert.equal(await page.evaluate(() => StorySpot.state.playIntent), true);
      assert.equal(await page.evaluate(() => StorySpotMCQ.isSpeaking), true);
    });
    await page.evaluate(() => {
      StorySpot.stop();StorySpot.state.savedOnly=false;
      window.__three={...__two,id:'third',title:'Third story'};
      StorySpot.loadCatalog({bookId:'fixture-book',stories:[__one,__two,__three]});
      StorySpot.state.index=0;StorySpot.selectTrack('story');StorySpot.selectTrack('mcq');StorySpot.togglePlay();
      onMCQSpeech({id:__speech.at(-1).id,state:'start'});
      StorySpot.loadCatalog({bookId:'fixture-book',stories:[__two,__three]});
      StorySpot.move(1);
    });
    await check('Removal of current story does not skip its successor', async () => {
      assert.equal(await page.evaluate(() => StorySpot.state.visible[StorySpot.state.index]?.id), 'second');
      assert.equal(await page.evaluate(() => StorySpot.state.playIntent), true);
    });
    assert.deepEqual(errors, [], 'No browser errors');
    assert.deepEqual(failures, [], failures.join('\n'));
    console.log('Catalog metadata, same-book saved filtering, reduced-library playback, and removed-story navigation checks passed.');
  } finally {
    await browser.close();await new Promise(resolve => server.close(resolve));
  }
})().catch(error => {console.error(error);process.exitCode=1;server.close();});
