'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const MODULE = require.resolve('../api/youtube.js');
function loadFresh(){ delete require.cache[MODULE]; return require(MODULE); }
function makeRes(){
  return {statusCode:200,headers:{},body:null,setHeader(k,v){this.headers[k]=v;return this;},status(n){this.statusCode=n;return this;},json(v){this.body=v;return this;}};
}
async function call(handler,query={}) { const res=makeRes();await handler({method:'GET',query},res);return res; }
function ok(body,status=200,header={}) { return {ok:status>=200&&status<300,status,headers:{get:k=>header[k.toLowerCase()]||null},json:async()=>body}; }
const VIDEO_ID='XxYyZz01234';
const INV_VIDEO={type:'video',videoId:VIDEO_ID,title:'Lvbel C5 – Test',author:'Test channel',authorId:'UC_test',lengthSeconds:185,viewCount:94500,published:1770000000};
const YT_VIDEO={id:VIDEO_ID,status:{embeddable:true,privacyStatus:'public'},snippet:{title:'Test Clip',channelTitle:'Official Channel',channelId:'UC_official',publishedAt:'2026-01-21T00:00:00.000Z'},contentDetails:{duration:'PT4M15S'},statistics:{viewCount:'12034',likeCount:'1200'}};

test('health exposes configuration flags, not the key',async()=>{
  process.env.YOUTUBE_API_KEY='secret-not-for-client';
  const handler=loadFresh();const res=await call(handler,{health:'1'});
  assert.equal(res.statusCode,200);assert.equal(res.body.version,'1.7.1');
  assert.equal(JSON.stringify(res.body).includes('secret-not-for-client'),false);
});
test('user search calls Invidious, not expensive YouTube search.list',async()=>{
  process.env.YOUTUBE_API_KEY='existing-google-key';
  process.env.INVIDIOUS_INSTANCES='https://inv.nadeko.net';
  const urls=[];
  global.fetch=async url=>{urls.push(String(url));return ok([INV_VIDEO]);};
  const handler=loadFresh();const res=await call(handler,{category:'Karışık',search:'lvbel c5'});
  assert.equal(res.statusCode,200);assert.equal(res.body.source,'Invidious');
  assert.equal(res.body.items[0].id,'youtube:'+VIDEO_ID);
  assert.equal(res.body.items[0].is_short,false);
  assert.match(urls[0],/\/api\/v1\/search\?/);
  assert.equal(new URL(urls[0]).searchParams.get('q'),'lvbel c5');
  assert.equal(urls.some(u=>u.includes('googleapis.com')),false);
});
test('duplicate request is returned from cache, without a second upstream call',async()=>{
  process.env.INVIDIOUS_INSTANCES='https://inv.nadeko.net';
  let count=0;global.fetch=async()=>{count++;return ok([INV_VIDEO]);};
  const handler=loadFresh();await call(handler,{category:'Karışık',search:'lvbel c5'});
  const next=await call(handler,{category:'Karışık',search:'lvbel c5'});
  assert.equal(count,1);assert.equal(next.headers['X-Pikniktup-Cache'],'HIT');
});
test('host fallback works on first instance 502 and does not expose upstream error',async()=>{
  process.env.INVIDIOUS_INSTANCES='https://inv.nadeko.net,https://invidious.nerdvpn.de';
  let count=0;global.fetch=async url=>{count++;return count===1?ok({error:'upstream'},502):ok([INV_VIDEO]);};
  const handler=loadFresh();const res=await call(handler,{search:'test search'});
  assert.equal(res.statusCode,200);assert.equal(res.body.items.length,1);assert.equal(count,2);
});
test('rate-limit results in bounded retry and friendly error after hosts fail',async()=>{
  process.env.INVIDIOUS_INSTANCES='https://inv.nadeko.net,https://invidious.nerdvpn.de';
  let count=0;global.fetch=async()=>{count++;return ok({error:'rateLimitExceeded'},429,{'retry-after':'180'});};
  const handler=loadFresh();const res=await call(handler,{search:'new search'});
  assert.equal(res.statusCode,503);assert.equal(res.body.code,'INVIDIOUS_UNAVAILABLE');
  assert.ok(res.body.retry_after_seconds >= 60);
  assert.equal(count,2);
  const next=await call(handler,{search:'new search 2'});
  assert.equal(next.statusCode,429);assert.equal(count,2);
});
test('homepage official trending remains compatible',async()=>{
  process.env.YOUTUBE_API_KEY='key';
  process.env.INVIDIOUS_INSTANCES='https://inv.nadeko.net';
  const urls=[];global.fetch=async url=>{urls.push(String(url));return ok({items:[YT_VIDEO],nextPageToken:'ABC123'});};
  const handler=loadFresh();const res=await call(handler,{category:'Karışık'});
  assert.equal(res.statusCode,200);assert.equal(res.body.source,'YouTube');
  assert.equal(res.body.has_more,true);assert.equal(res.body.next_page_token,'ABC123');
  assert.equal(res.body.items[0].duration_seconds,255);
  assert.equal(urls.length,1);assert.match(urls[0],/youtube\/v3\/videos/);
});
test('without a Google key, homepage falls back to Invidious trending',async()=>{
  delete process.env.YOUTUBE_API_KEY;
  process.env.INVIDIOUS_INSTANCES='https://inv.nadeko.net';
  const urls=[];global.fetch=async url=>{urls.push(String(url));return ok([INV_VIDEO]);};
  const handler=loadFresh();const res=await call(handler,{category:'Karışık'});
  assert.equal(res.statusCode,200);assert.equal(res.body.items[0].youtube,true);
  assert.match(urls[0],/\/api\/v1\/trending\?/);
});
test('details use official videos endpoint, not search endpoint',async()=>{
  process.env.YOUTUBE_API_KEY='key';
  global.fetch=async()=>ok({items:[YT_VIDEO]});
  const handler=loadFresh();const res=await call(handler,{id:VIDEO_ID});
  assert.equal(res.statusCode,200);assert.equal(res.body.item.youtube_id,VIDEO_ID);
});
test('invalid inputs rejected without network calls',async()=>{
  global.fetch=async()=>{throw Error('Should not fetch');};
  const handler=loadFresh();
  assert.equal((await call(handler,{id:'../../etc/passwd'})).statusCode,400);
  assert.equal((await call(handler,{search:'x'})).statusCode,400);
  assert.equal((await call(handler,{pageToken:'../../etc/passwd'})).statusCode,400);
});
test('invalid results are filtered and remain escaped as data',async()=>{
  process.env.INVIDIOUS_INSTANCES='https://inv.nadeko.net';
  global.fetch=async()=>ok([{type:'playlist',videoId:VIDEO_ID},{...INV_VIDEO,videoId:'invalid'}, {...INV_VIDEO,title:'<img src=x onerror=alert(1)>'}]);
  const handler=loadFresh();const res=await call(handler,{search:'some query'});
  assert.equal(res.body.items.length,1);assert.equal(res.body.items[0].title,'<img src=x onerror=alert(1)>'); // frontend must HTML-escape titles via esc()
  assert.equal(res.body.items[0].thumb_url,`https://i.ytimg.com/vi/${VIDEO_ID}/hqdefault.jpg`);
});
