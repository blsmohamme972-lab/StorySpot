/* Pending native TTS callbacks must retain playback intent across seek and sync. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '../web');
const server = http.createServer((request, response) => {
  const filename = path.resolve(root, '.' + (request.url === '/' ? '/index.html' : request.url.split('?')[0]));
  if (!filename.startsWith(root + path.sep)) return response.writeHead(403).end();
  fs.readFile(filename, (error, bytes) => {
    if (error) return response.writeHead(404).end();
    response.setHeader('Content-Type', filename.endsWith('.js') ? 'text/javascript' : filename.endsWith('.html') ? 'text/html' : filename.endsWith('.css') ? 'text/css' : 'application/octet-stream');
    response.end(bytes);
  });
});
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox']});
  const page = await browser.newPage({viewport: {width: 390, height: 844}});
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/drive-sync.js', route => route.fulfill({contentType: 'text/javascript', body: 'window.StorySpotSync={init:c=>c,useCatalog(){},sync:async()=>{}};'}));
  await page.addInitScript(() => {
    window.__speech = []; window.__stops = 0;
    window.StorySpotNative = {ready(){}, getItem: () => '', setItem(){}, setPlaybackActive(){},
      speakMcq(id, text) { __speech.push({id, text}); }, stopMcq() { __stops++; }};
  });
  try {
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.waitForFunction(() => window.StorySpot?.state.booted);
    await page.evaluate(() => {
      window.__fixture = {id: 'mcq-seek-race', title: 'Race fixture',
        image: 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>'),
        mcq: {stem: 'Which option?', key: 'B', explanation: 'Original rationale.', options: [{label:'A', text:'First', explanation:'First rationale.'}, {label:'B', text:'Second'}]}};
      StorySpot.loadCatalog({stories:[__fixture]});
      StorySpot.selectTrack('mcq'); StorySpot.togglePlay();
      onMCQSpeech({id: __speech.at(-1).id, state: 'start'});
      StorySpot.seek(1);
    });
    assert.equal(await page.evaluate(() => StorySpotMCQ.isSpeaking), true, 'Seek resumes native narration');
    assert.equal(await page.evaluate(() => StorySpot.state.playIntent), true, 'Pending speech after seek retains intent before the native start callback');
    const resumed = await page.evaluate(() => __speech.at(-1).id);
    const stops = await page.evaluate(() => __stops);
    await page.evaluate(() => StorySpot.loadCatalog({stories:[{...__fixture, mcq:{...__fixture.mcq, explanation:'Updated rationale.'}}]}));
    assert.equal(await page.evaluate(() => __stops), stops, 'An update during pending TTS must defer rather than cancel narration');
    assert.equal(await page.evaluate(() => StorySpotMCQ.currentTime()), 1, 'The resumed speech step stays selected');
    await page.evaluate(id => onMCQSpeech({id, state:'start'}), resumed);
    assert.equal(await page.evaluate(() => StorySpot.state.playing), true, 'The pending callback still belongs to the active narration');
    await page.evaluate(id => onMCQSpeech({id, state:'done'}), resumed);
    await page.evaluate(() => { const id=__speech.at(-1).id; onMCQSpeech({id,state:'start'}); onMCQSpeech({id,state:'done'}); });
    assert.equal(await page.locator('#mcqReason').textContent(), '', 'Finishing applies updated content and resets its question step');
    await page.evaluate(() => { StorySpot.togglePlay(); onMCQSpeech({id:__speech.at(-1).id,state:'done'}); onMCQSpeech({id:__speech.at(-1).id,state:'start'}); });
    assert.equal(await page.locator('#mcqReason').textContent(), 'Updated rationale.', 'The deferred correction becomes available after narration finishes');
    assert.deepEqual(errors, []);
    console.log('Pending MCQ seek/sync race regression passed.');
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => {console.error(error); process.exitCode = 1; server.close();});
