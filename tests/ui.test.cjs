/* Remote-only UI regression. Real media fixtures live outside the APK asset directory. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'../web'),authoring=path.resolve(__dirname,'../production/remote-library');
const artifacts=path.resolve(__dirname,'../test-results');fs.mkdirSync(artifacts,{recursive:true});
const original=JSON.parse(fs.readFileSync(path.join(authoring,'catalog-source.json'),'utf8'));
const media={},texts={},files=[];
const manifest={schemaVersion:2,stories:original.stories.map((story,index)=>{
  const imageId=story.drive.imageId,textId=story.drive.textId;
  media[imageId]=path.join(authoring,story.image);texts[textId]=story.storyText;
  files.push({id:imageId,name:story.drive.originalName,mime:'image/png',modifiedTime:Date.parse(story.drive.imageModifiedTime)});
  files.push({id:textId,name:story.drive.textOriginalName,mime:'text/plain',modifiedTime:Date.parse(story.drive.textModifiedTime)});
  const next={...story,image:imageId};
  for(const track of ['storyAudio','explanationAudio']){const id=`remote_audio_${index}_${track}`;media[id]=path.join(authoring,story[track]);next[track]=id;files.push({id,name:`audio-${index}-${track}.mp3`,mime:'audio/mpeg',modifiedTime:1800000000000});}
  return next;
})};
const manifestId='remote_manifest_catalog_001';files.push({id:manifestId,name:'catalog.json',mime:'application/json',modifiedTime:1800000000000});
media.remote_standalone_image_001=media[manifest.stories[0].image];media.remote_standalone_image_002=media[manifest.stories[1].image];
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.mp3':'audio/mpeg','.ttf':'font/ttf'};
function response(data,type,range){const match=range?.match(/^bytes=(\d+)-(\d*)$/);if(match){const start=Number(match[1]),end=match[2]?Math.min(data.length-1,Number(match[2])):data.length-1;if(start>end)return{status:416,headers:{'Content-Range':`bytes */${data.length}`},body:''};return{status:206,headers:{'Content-Type':type,'Content-Length':String(end-start+1),'Accept-Ranges':'bytes','Content-Range':`bytes ${start}-${end}/${data.length}`},body:data.subarray(start,end+1)};}return{status:200,headers:{'Content-Type':type,'Content-Length':String(data.length),'Accept-Ranges':'bytes'},body:data};}
const requests=[];
const server=http.createServer((req,res)=>{const pathname=decodeURIComponent(req.url.split('?')[0]);requests.push(pathname);const target=path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));if(!target.startsWith(root+path.sep)){res.writeHead(403).end();return;}fs.readFile(target,(error,data)=>{if(error){res.writeHead(404).end();return;}const r=response(data,mime[path.extname(target)]||'application/octet-stream',req.headers.range);res.writeHead(r.status,r.headers).end(r.body);});});
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`;
  const browserPath=process.env.CHROMIUM_PATH||['/usr/bin/chromium','/usr/bin/chromium-browser','/usr/bin/google-chrome'].find(file=>fs.existsSync(file));
  const browser=await chromium.launch({...(browserPath?{executablePath:browserPath}:{}),headless:true,args:['--no-sandbox']});
  const page=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:1});const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.route('https://appassets.androidplatform.net/remote/**',async route=>{const id=new URL(route.request().url()).pathname.split('/').pop();const file=media[id];if(!file)return route.fulfill({status:404,body:'No fixture'});const data=fs.readFileSync(file),r=response(data,mime[path.extname(file)]||'application/octet-stream',route.request().headers().range);await route.fulfill(r);});
  await page.addInitScript(({manifest,files,texts,manifestId})=>{
    if(!localStorage.getItem('__mock.initialized')){
      localStorage.setItem('__mock.initialized','1');localStorage.setItem('__mock.offline','true');
      localStorage.setItem('storyspot.saved',JSON.stringify(['legacy-saved-id']));
      const legacy={stories:[{id:'legacy',title:'Old bundled story',image:'content/images/old.png',storyAudio:'content/audio/old.mp3'}]};
      localStorage.setItem('storyspot.imported',JSON.stringify(legacy));localStorage.setItem('storyspot.drive.catalog.v1',JSON.stringify(legacy));localStorage.setItem('storyspot.drive.catalog.v2',JSON.stringify({...legacy,remoteOnly:true}));
    }
    window.__driveMock={requests:0,registrations:0};
    function folder(){const count=Number(localStorage.getItem('__mock.added')||0);const all=[...files];for(let i=1;i<=count;i++)all.push({id:`remote_standalone_image_00${i}`,name:`New artwork ${i}.png`,mime:'image/png',modifiedTime:1800000000000});const records=all.map(file=>{const row=[];row[0]=file.id;row[1]=[];row[2]=file.name;row[3]=file.mime;row[10]=file.modifiedTime;row[13]=5000;return row;});return `<script>window['_DRIVE_ivd'] = '${JSON.stringify([records]).replace(/'/g,'\\x27')}';<\/script>`;}
    window.StorySpotNative={
      getItem:key=>localStorage.getItem(key)||'',setItem:(key,value)=>localStorage.setItem(key,value),ready(){},openDriveFolder:()=>true,
      registerMedia(url){window.__driveMock.registrations++;const id=new URL(url).searchParams.get('id');return `https://appassets.androidplatform.net/remote/${id}`;},
      fetchText(id,url){window.__driveMock.requests++;setTimeout(()=>{if(localStorage.getItem('__mock.offline')==='true'){window.onNativeResponse({id,ok:false,error:'No internet connection'});return;}const fileId=new URL(url).searchParams.get('id');const text=url.includes('/folders/')?folder():fileId===manifestId?JSON.stringify(manifest):texts[fileId];window.onNativeResponse({id,ok:typeof text==='string',text,error:'Unknown fixture file'});},30);}
    };
  },{manifest,files,texts,manifestId});
  try{
    await page.goto(origin);await page.waitForFunction(()=>window.StorySpot?.state.booted&&!StorySpot.state.syncing);
    assert.equal(await page.evaluate(()=>StorySpot.state.stories.length),0,'First launch has no bundled media or legacy fallback');
    assert.equal(await page.locator('#savedCount').textContent(),'1','Migration preserves saved IDs');
    assert.match(await page.locator('#emptyMessage').textContent(),/Connect to the internet to load your Google Drive library/);
    assert(await page.locator('#refreshButton').isVisible(),'Drive sync is available on the main screen');
    await page.screenshot({path:path.join(artifacts,'storyspot-first-use-offline.png')});
    await page.evaluate(()=>localStorage.setItem('__mock.offline','false'));await page.reload();
    await page.waitForFunction(()=>StorySpot.state.stories.length===11&&!StorySpot.state.syncing);
    await page.waitForFunction(()=>document.getElementById('storyImage').naturalWidth>0);
    const first=await page.evaluate(()=>StorySpot.state.stories[0]);assert.match(first.storyText,/[\u0600-\u06ff]/);assert(!/[\u0600-\u06ff]/.test(first.explanationText));
    const durations=await page.evaluate(async()=>{const result=[];for(const story of StorySpot.state.stories){for(const key of ['storyAudio','explanationAudio']){result.push(await new Promise((resolve,reject)=>{const a=new Audio();const timer=setTimeout(()=>reject(new Error('Metadata timeout')),10000);a.onloadedmetadata=()=>{clearTimeout(timer);resolve(a.duration);a.removeAttribute('src');a.load();};a.onerror=()=>{clearTimeout(timer);reject(new Error('Remote audio failed '+story.id+' '+key));};a.src=story[key];}));}}return result;});
    assert.equal(durations.length,22);assert(durations.every(n=>Number.isFinite(n)&&n>1),'All remote recordings load with duration');
    await page.locator('#playButton').click();await page.waitForFunction(()=>document.getElementById('audio').currentTime>.15);await page.locator('#playButton').click();
    const cue=first.cues.find(c=>c.pointer!==false&&c.label);await page.evaluate(t=>StorySpot.seek(t),cue.time+.1);await page.waitForFunction(()=>!document.getElementById('audio').seeking);assert(await page.locator('#pointer').isVisible());assert.equal(await page.locator('#motionLabel').textContent(),cue.label,'Remote timing follows real voice position');
    await page.locator('#transcriptButton').click();assert.equal(await page.locator('#transcriptBody').getAttribute('dir'),'rtl');await page.locator('[data-close="transcriptDialog"]').click();await page.locator('#explainTrack').click();await page.locator('#transcriptButton').click();assert.equal(await page.locator('#transcriptBody').getAttribute('dir'),'ltr');await page.locator('[data-close="transcriptDialog"]').click();
    await page.locator('#saveButton').click();assert.equal(await page.locator('#savedCount').textContent(),'2');
    await page.locator('#viewer').focus();await page.keyboard.press('ArrowDown');assert.notEqual(await page.locator('#storyTitle').textContent(),first.title);
    await page.evaluate(()=>localStorage.setItem('__mock.added','1'));await page.locator('#refreshButton').click();await page.waitForFunction(()=>StorySpot.state.stories.length===12&&!StorySpot.state.syncing);
    const standalone=await page.evaluate(()=>StorySpot.state.stories.find(s=>s.drive.imageId==='remote_standalone_image_001'));assert(standalone,'Image added after install appears without rebuilding APK');assert(!standalone.storyAudio&&!standalone.explanationAudio,'Missing narration remains explicit');
    await page.evaluate(id=>{StorySpot.state.index=StorySpot.state.stories.findIndex(s=>s.id===id);StorySpot.move(0);},standalone.id);assert(await page.locator('#playButton').isDisabled());assert(await page.locator('#pointer').isHidden());
    await page.evaluate(()=>{StorySpot.state.index=0;StorySpot.move(0);});await page.locator('#storyTrack').click();await page.waitForFunction(()=>document.getElementById('audio').readyState>=2);await page.evaluate(()=>StorySpot.seek(3));await page.waitForFunction(()=>!document.getElementById('audio').seeking);await page.locator('#playButton').click();await page.waitForFunction(()=>document.getElementById('audio').currentTime>3.05);
    await page.evaluate(()=>{localStorage.setItem('__mock.added','2');StorySpot.state.lastSync=0;window.dispatchEvent(new Event('storyspot:resume'));});await page.waitForFunction(()=>StorySpot.state.stories.length===13&&!StorySpot.state.syncing);
    assert(await page.evaluate(()=>StorySpot.state.playing&&document.getElementById('audio').currentTime>3),'Automatic discovery keeps the current voice playing at its existing position');await page.locator('#playButton').click();
    await page.evaluate(()=>{StorySpot.state.index=0;StorySpot.move(0);});await page.waitForFunction(()=>document.getElementById('storyImage').naturalWidth>0);await page.screenshot({path:path.join(artifacts,'storyspot-mobile.png')});
    await page.setViewportSize({width:360,height:640});assert(await page.locator('#refreshButton').isVisible());assert(await page.evaluate(()=>document.querySelector('.app').getBoundingClientRect().bottom<=innerHeight+1));await page.setViewportSize({width:1440,height:1000});await page.screenshot({path:path.join(artifacts,'storyspot-desktop.png')});await page.setViewportSize({width:390,height:844});
    await page.evaluate(()=>localStorage.setItem('__mock.offline','true'));await page.reload();await page.waitForFunction(()=>StorySpot.state.stories.length===13&&!StorySpot.state.syncing);await page.waitForFunction(()=>document.getElementById('storyImage').naturalWidth>0);assert.equal(await page.locator('#savedCount').textContent(),'2','Saved state survives remote refresh and offline reopen');
    assert(!requests.some(p=>p.startsWith('/content/')),'Runtime never requests removed bundled content');assert.deepEqual(errors,[]);
    console.log('PASS: empty APK/legacy migration, first-use offline, launch sync, 11 remote stories and 22 real recordings, real voice/camera seeking, Arabic/English transcripts, main refresh discovers image-only additions, native resume sync, cached offline reopen, saved IDs and phone layouts.');
  }finally{await browser.close();server.close();}
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});
