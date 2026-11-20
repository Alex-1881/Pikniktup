/* Pikniktüp 1.6 — YouTube Data API v3 server-side gateway.
   Only YouTube's official embedded player is used for video playback.
   Set YOUTUBE_API_KEY in Vercel server environment, never in frontend code. */
'use strict';
const ENDPOINT='https://www.googleapis.com/youtube/v3/';
const categoryIds=Object.freeze({'Müzik':'10','Şarkılar':'10','Oyun':'20','Komedi':'23','Eğlence':'24','Film/Dizi':'1','Spor':'17','Eğitim':'27','Teknoloji':'28','Yaşam':'22','Haber':'25'});
const regexId=/^[A-Za-z0-9_-]{11}$/;
const regexPage=/^[A-Za-z0-9_-]{1,180}$/;
const asText=(x,n=100)=>String(x||'').slice(0,n);
const isVideo=x=>x?.status?.embeddable===true && x?.status?.privacyStatus==='public' && regexId.test(x?.id);
const durationSecs=x=>{const m=/^P(?:([0-9]+)D)?T?(?:([0-9]+)H)?(?:([0-9]+)M)?(?:([0-9]+)S)?$/.exec(String(x||''));return m?Number(m[1]||0)*86400+Number(m[2]||0)*3600+Number(m[3]||0)*60+Number(m[4]||0):0};
function normalize(v){const s=v.snippet||{},th=s.thumbnails||{};
 return {id:'youtube:'+v.id,youtube:true,demo:true,owner_id:'youtube',youtube_id:v.id,title:asText(s.title,210),description:asText(s.description,2500),author:asText(s.channelTitle||'YouTube kanalı',150),channel_id:s.channelId||'',category:'YouTube',is_short:durationSecs(v.contentDetails?.duration)>0&&durationSecs(v.contentDetails?.duration)<=60,duration_seconds:durationSecs(v.contentDetails?.duration),views:Number(v.statistics?.viewCount||0),likes_count:Number(v.statistics?.likeCount||0),comments_count:Number(v.statistics?.commentCount||0),created_at:s.publishedAt||'',thumb_url:th.maxres?.url||th.standard?.url||th.high?.url||th.medium?.url||`https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`,source_page:`https://www.youtube.com/watch?v=${v.id}`};
}
async function youtube(endpoint,args,key){const qs=new URLSearchParams(args);qs.set('key',key);const ctrl=new AbortController();const tm=setTimeout(()=>ctrl.abort(),9500);
 try{const response=await fetch(ENDPOINT+endpoint+'?'+qs,{signal:ctrl.signal,headers:{Accept:'application/json'}});const payload=await response.json().catch(()=>({}));if(!response.ok){const reason=payload?.error?.errors?.[0]?.reason||'';const error=new Error(reason||'YouTube servisi yanıt vermiyor');error.status=response.status;error.reason=reason;throw error;}return payload;}finally{clearTimeout(tm)}
}
module.exports=async function handler(req,res){
 if(req.method!=='GET'){res.setHeader('Allow','GET');return res.status(405).json({error:'Sadece GET desteklenir'});}
 const key=process.env.YOUTUBE_API_KEY;
 if(!key)return res.status(503).json({error:'YouTube anahtarı eksik',code:'YOUTUBE_KEY_MISSING',message:'Vercel → Environment Variables → YOUTUBE_API_KEY eklenmeli.'});
 const q=req.query||{};
 const videoId=typeof q.id==='string'&&regexId.test(q.id)?q.id:null;
 const search=asText(q.search,75).normalize('NFKC').trim();
 const specialties=['Klipler','Canlı','Shorts'];
 const category=typeof q.category==='string'&&(categoryIds[q.category]||specialties.includes(q.category))?q.category:'Karışık';
 const pageToken=typeof q.pageToken==='string'&&regexPage.test(q.pageToken)?q.pageToken:'';
 if(q.id&&!videoId)return res.status(400).json({error:'Geçersiz YouTube video kimliği'});
 if(q.search&&search.length<2)return res.status(400).json({error:'Arama için en az 2 karakter gerekli'});
 if(q.pageToken&&!pageToken)return res.status(400).json({error:'Geçersiz sayfa belirteci'});
 res.setHeader('Cache-Control','public, s-maxage=300, stale-while-revalidate=1800');
 try{
  const fields={part:'snippet,contentDetails,statistics,status',maxResults:videoId?'1':'24'};
  if(videoId){const data=await youtube('videos',{...fields,id:videoId},key);const item=(data.items||[]).filter(isVideo).map(normalize)[0]||null;return res.status(200).json({item,items:item?[item]:[],has_more:false,source:'YouTube'});}
  let data;
  if(search||['Film/Dizi','Klipler','Canlı','Shorts'].includes(category)){
   const searchTerms={'Film/Dizi':'dizi resmi kanal bölüm fragman','Klipler':'resmi klip official music video','Canlı':'canlı performans live concert','Shorts':'#shorts Türkiye'};
   let term=search||searchTerms[category]||'';
   if(search&&category==='Klipler')term+=' official music video klip';
   else if(search&&category==='Canlı')term+=' live performance';
   else if(search&&category==='Shorts')term+=' #shorts';
   const args={part:'snippet',type:'video',maxResults:'30',q:term,regionCode:'TR',relevanceLanguage:'tr',safeSearch:'strict',videoEmbeddable:'true',videoSyndicated:'true'};
   if(category==='Klipler'||category==='Canlı')args.videoCategoryId='10';
   if(category==='Shorts')args.videoDuration='short';
   if(pageToken)args.pageToken=pageToken;
   const results=await youtube('search',args,key);
   const ids=(results.items||[]).map(it=>it.id?.videoId).filter(id=>regexId.test(id));
   if(!ids.length)return res.status(200).json({items:[],has_more:false,next_page_token:'',source:'YouTube'});
   const details=await youtube('videos',{...fields,id:ids.join(','),maxResults:String(ids.length)},key);
   const byId=new Map((details.items||[]).filter(isVideo).map(v=>[v.id,v]));
   let candidates=ids.map(id=>byId.get(id)).filter(Boolean);
   if(category==='Klipler'){
    // Reject recognizable static-cover / autogenerated audio, lyrics and visualizers.
    // Metadata is heuristic: it cannot verify the visual content of every clip.
    candidates=candidates.filter(v=>!/(official\s*audio|audio\s*only|lyric(?:s)?\s*video|sözleri|visuali[sz]er|\btopic\b|full\s*album|albümün\s*tamamı)/i.test(String(v.snippet?.title||'')+' '+String(v.snippet?.channelTitle||'')));
   }
   if(category==='Shorts')candidates=candidates.filter(v=>{const d=durationSecs(v.contentDetails?.duration);return d>0&&d<=180});
   data={items:candidates,nextPageToken:results.nextPageToken||''};
  }else{
   const args={...fields,chart:'mostPopular',regionCode:'TR'};
   if(categoryIds[category])args.videoCategoryId=categoryIds[category];
   if(pageToken)args.pageToken=pageToken;
   data=await youtube('videos',args,key);
  }
  let result=(data.items||[]).filter(isVideo);
  if(category==='Karışık'&&!search)result=result.filter(v=>!/(official\s*audio|audio\s*only|\btopic\b|lyric(?:s)?\s*video)/i.test(String(v.snippet?.title||'')+' '+String(v.snippet?.channelTitle||'')));
  const items=result.map(normalize);
  return res.status(200).json({items,has_more:Boolean(data.nextPageToken),next_page_token:data.nextPageToken||'',source:'YouTube',category});
 }catch(err){console.warn('YouTube API:',err.status||'network',err.reason||err.message);const status=err.status===403?503:502;
  const message=err.status===403?'YouTube API anahtarı, kota veya izin sorunu. Google Cloud ayarlarını kontrol et.':'YouTube bağlantısı geçici olarak kurulamadı.';
  return res.status(status).json({error:message,code:err.status===403?'YOUTUBE_API_DENIED':'YOUTUBE_API_ERROR'});
 }
};
