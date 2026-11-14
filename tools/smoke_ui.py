import json, time, pathlib, re
from playwright.sync_api import sync_playwright
root=pathlib.Path(__file__).resolve().parents[1] / 'web'
html=(root/'index.html').read_text()
html=re.sub(r'<meta http-equiv="Content-Security-Policy"[^>]*>', '', html)
html=html.replace('<link rel="stylesheet" href="styles.css">','<style>'+(root/'styles.css').read_text()+'</style>')
for name in ['drive-sync.js','quotes.js','mcq.js','books.js','app.js']:
    script=('window.StorySpotSync={init:c=>c,useCatalog(){},sync:async()=>{}};' if name=='drive-sync.js' else (root/name).read_text())
    html=html.replace('<script src="'+name+'"></script>','<script>'+script+'</script>')
html=html.replace('<body>','<body><script>window.StorySpotNative={ready(){},getItem:()=>"",setItem(){},setPlaybackActive(){},stopMcq(){},speakMcq(){}};</script>')
checks=[]
with sync_playwright() as pw:
    browser=pw.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
    page=browser.new_page(viewport={'width':390,'height':844},is_mobile=True,has_touch=True,device_scale_factor=1)
    console_errors=[]
    page.on('pageerror',lambda e:console_errors.append(str(e)))
    page.set_content(html,wait_until='load',timeout=15000)
    page.wait_for_function('window.StorySpot?.state.booted',timeout=15000)
    page.evaluate('''() => {let image='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800"><rect width="600" height="800" fill="#7c8b73"/><path d="M0 0L600 800M600 0L0 800" stroke="#e5eab2" stroke-width="15"/><rect x="100" y="100" width="400" height="600" rx="100" fill="#adbaa6" stroke="#fff" stroke-width="3"/><circle cx="300" cy="370" r="105" fill="#485f55"/></svg>');StorySpot.loadCatalog({stories:[...Array(4)].map((_,i)=>({id:'demo-'+i,title:'A visual story '+i,image,storyText:'Demo',mcq:{stem:'What is shown?',options:[{label:'A',text:'A shape'},{label:'B',text:'A square'}],key:'A',explanation:'Shapes.'}}))});}''')
    for w,h in [(320,568),(360,600),(390,700),(390,844),(430,932),(844,390),(640,360)]:
        page.set_viewport_size({'width':w,'height':h})
        page.wait_for_timeout(100)
        data=page.evaluate('''() => {let rect=id=>{const x=document.querySelector(id).getBoundingClientRect();return {x:x.x,y:x.y,width:x.width,height:x.height,bottom:x.bottom,right:x.right}};let v=rect('#viewer'),t=rect('.viewer-top'),b=rect('.side-actions'),s=rect('#scene'),buttons=[...document.querySelectorAll('#app button')].filter(e=>e.getClientRects().length),hidden=buttons.filter(e=>{let r=e.getBoundingClientRect(),h=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return r.x<0||r.right>innerWidth||r.y<0||r.bottom>innerHeight||!h||!(h===e||e.contains(h));}).map(e=>e.id);return {v,t,b,s,hidden,docWidth:document.documentElement.scrollWidth,windowWidth:innerWidth,sceneNaturalWidth:document.getElementById('storyImage').naturalWidth}}''')
        checks.append({'viewport':f'{w}x{h}','viewer_h':round(data['v']['height']), 'controlsAbove':data['b']['bottom']<=data['v']['y']+.1,'unreachable':data['hidden'],'horizontalOverflow':data['docWidth']>data['windowWidth'],'imgLoaded':data['sceneNaturalWidth']>0})
        if w==390 and h==844 and (root.parent / 'build').is_dir(): page.screenshot(path=str(pathlib.Path(__file__).resolve().parents[1] / 'build' / 'ui-preview.png'),full_page=True)
    page.set_viewport_size({'width':390,'height':844})
    def touch(t,points,changed=None):
        page.evaluate('''([kind,points,changed])=>{let e=document.getElementById('viewer');const make=p=>new Touch({identifier:p.id,target:e,clientX:p.x,clientY:p.y});e.dispatchEvent(new TouchEvent(kind,{bubbles:true,cancelable:true,touches:points.map(make),changedTouches:(changed||points).map(make)}));}''',[t,points,changed])
    touch('touchstart',[{'id':1,'x':180,'y':570}]);touch('touchmove',[{'id':1,'x':180,'y':500}]);
    drag=page.evaluate("document.getElementById('scene').style.translate")
    touch('touchend',[],[{'id':1,'x':180,'y':450}]);
    first=page.evaluate('StorySpot.state.index')
    page.wait_for_timeout(250)
    animations=page.locator('.swipe-outgoing').count()
    touch('touchstart',[{'id':1,'x':180,'y':500}]);touch('touchend',[],[{'id':1,'x':180,'y':473}]);
    second=page.evaluate('StorySpot.state.index')
    touch('touchstart',[{'id':1,'x':180,'y':480}]); touch('touchmove',[{'id':1,'x':180,'y':445}]);touch('touchend',[],[{'id':1,'x':180,'y':445}]);
    third=page.evaluate('StorySpot.state.index')
    print(json.dumps({'layouts':checks,'swipe':{'drag_feedback':drag,'large_swipe_result':first,'short_tap_index':second,'quick_flick_index':third,'outgoing_removed':animations==0},'page_errors':console_errors},indent=2))
    browser.close()

