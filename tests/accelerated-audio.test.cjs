/* Exercise the same-origin complete-file path with original MP3 recordings. */
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require('playwright');
const web=path.resolve(__dirname,'../web'),media=path.resolve(__dirname,'../production/remote-library/content/audio');
const recordings=['story-1-story.mp3','story-1-explanation.mp3'];
let requests=0;
const server=http.createServer((req,res)=>{
 const match=req.url.match(/^\/remote\/([ab]){64}$/);
 let file;
 if(match){requests++;file=path.join(media,recordings[req.url.includes('a')?0:1]);}
 else file=path.resolve(web,'.'+(req.url==='/'?'/index.html':req.url));
 if(!file.startsWith(web+'/')&&!file.startsWith(media+'/'))return res.writeHead(403).end();
 fs.readFile(file,(err,data)=>{
  if(err)return res.writeHead(404).end();
  res.setHeader('Content-Type',file.endsWith('.mp3')?'audio/mpeg':file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');
  res.setHeader('Content-Length',data.length);res.end(data);
 });
});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--autoplay-policy=no-user-gesture-required']});
 const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('https://storyspot.test/**',async route=>{const response=await route.fetch({url:`http://127.0.0.1:${server.address().port}${new URL(route.request().url()).pathname}`});await route.fulfill({response});});
 await page.route('**/drive-sync.js',r=>r.fulfill({contentType:'text/javascript',body:'window.StorySpotSync={init:c=>c,useCatalog(){},sync:async()=>{}};'}));
 try{
  await page.goto('https://storyspot.test/');
  await page.waitForFunction(()=>window.StorySpot?.state.booted);
  await page.evaluate(()=>{
   const image='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800"><rect width="600" height="800" fill="#769078"/></svg>');
   window.fixture={id:'accelerated',title:'Unobstructed artwork',subtitle:'The title and controls sit outside the image.',image,storyAudio:location.origin+'/remote/'+'a'.repeat(64),explanationAudio:location.origin+'/remote/'+'b'.repeat(64)};
   StorySpot.loadCatalog({stories:[fixture,{...fixture,id:'second'}]});
  });
  for(const track of ['story','explanation']){
   await page.evaluate(track=>StorySpot.selectTrack(track),track);
   await page.locator('#speedButton').evaluate(b=>{while(b.textContent!=='2×')b.click();});
   await page.evaluate(()=>StorySpot.togglePlay());
   await page.waitForFunction(()=>StorySpot.state.playing&&document.getElementById('audio').src.startsWith('blob:'));
   assert.equal(await page.locator('#audio').evaluate(a=>a.playbackRate),2);
   await page.waitForFunction(()=>document.getElementById('audio').currentTime>22,null,{timeout:20000});
   assert.equal(await page.locator('#audio').evaluate(a=>a.paused),false,'Playback continues through 0:19 at 2×');
   await page.evaluate(()=>StorySpot.stop());
   const paused=await page.locator('#audio').evaluate(a=>a.currentTime);
   await page.waitForTimeout(150);
   assert.equal(await page.locator('#audio').evaluate(a=>a.currentTime),paused);
   await page.evaluate(()=>{StorySpot.seek(10);StorySpot.togglePlay();});
   await page.waitForFunction(()=>document.getElementById('audio').currentTime>10.4);
   await page.evaluate(()=>{const a=document.getElementById('audio');StorySpot.seek(a.duration-1);});
   await page.waitForFunction(()=>document.getElementById('audio').ended);
   assert.equal(await page.evaluate(()=>StorySpot.state.playIntent),false);
  }
  // A slow complete-file read cannot resume after Pause or replace a new track.
  await page.route('**/remote/'+'a'.repeat(64),async route=>{
   if(route.request().resourceType()==='fetch')await new Promise(r=>setTimeout(r,300));
   const response=await route.fetch({url:`http://127.0.0.1:${server.address().port}/remote/${'a'.repeat(64)}`});
   await route.fulfill({response});
  });
  await page.evaluate(()=>{StorySpot.selectTrack('story');void StorySpot.togglePlay();StorySpot.stop();});
  await page.waitForTimeout(450);
  assert.equal(await page.locator('#audio').evaluate(a=>a.paused),true,'Pause cancels pending play intent');
  await page.evaluate(()=>{StorySpot.selectTrack('explanation');void StorySpot.togglePlay();});
  await page.waitForFunction(()=>StorySpot.state.playing);
  assert.equal(await page.evaluate(()=>StorySpot.state.track),'explanation');
  await page.evaluate(()=>StorySpot.stop());
  await page.evaluate(()=>StorySpot.selectTrack('story'));
  for(const [width,height] of [[320,568],[360,560],[390,844]]){
   await page.setViewportSize({width,height});
   assert.equal(await page.evaluate(()=>{
    const art=document.getElementById('viewer').getBoundingClientRect();
    return ['storyTitle','storyCategory','storySubtitle','assetStatus','saveButton','transcriptButton','nextButton','positionLabel'].every(id=>{const r=document.getElementById(id).getBoundingClientRect();return r.bottom<=art.top||r.top>=art.bottom;});
   }),true,'Text and controls are outside the artwork');
  }
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:'test-results/portrait-0.3.2.png'});
  await page.evaluate(()=>document.getElementById('nextButton').click());
  assert.ok(await page.locator('#viewer').evaluate(e=>e.getAnimations({subtree:true}).length>0),'Story changes animate');
  await page.waitForTimeout(350);
  assert.equal(await page.locator('.swipe-outgoing').count(),0,'Old image is released');
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.evaluate(()=>document.getElementById('nextButton').click());
  assert.equal(await page.locator('#viewer').evaluate(e=>e.getAnimations({subtree:true}).length),0);
  assert.deepEqual(errors,[]);
  console.log('Original story and explanation MP3s passed 0:19 at 2×, pause/resume, seek, natural end, Blob source, separated layout and reduced-motion transitions.');
 }finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;server.close();});
