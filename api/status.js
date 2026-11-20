/* Public deployment diagnostics. Never return API keys or service secrets. */
'use strict';
module.exports=function handler(req,res){
 if(req.method!=='GET'){res.setHeader('Allow','GET');return res.status(405).json({error:'GET required'});}
 res.setHeader('Cache-Control','no-store, max-age=0');
 res.setHeader('Content-Type','application/json; charset=utf-8');
 return res.status(200).json({version:'1.6',youtubeApiConfigured:Boolean(process.env.YOUTUBE_API_KEY),supabaseConfigured:Boolean(process.env.SUPABASE_URL&&process.env.SUPABASE_ANON_KEY),engine:'YouTube Data API v3',sqlFilesBundled:false});
};
