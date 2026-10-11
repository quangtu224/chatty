import { sendError } from './auth.js';

// Provider errors never expose URLs (which include the private API key).
export function gifSearch({apiKey,fetchGifs=fetch}) {
  return async (req,res) => {
    const query=req.query.query;
    if(typeof query!=='string' || !query.trim() || Array.from(query.trim()).length>100)
      return sendError(req,res,400,'validation_failed','Enter a GIF search of 1–100 characters.',{query:'Enter a GIF search of 1–100 characters.'});
    res.set('Cache-Control','no-store');
    try {
      if(!apiKey) throw new Error('unconfigured');
      const url=new URL('https://api.giphy.com/v1/gifs/search');
      url.search=new URLSearchParams({api_key:apiKey,q:query.trim(),limit:'8',rating:'g'});
      const response=await fetchGifs(url,{signal:AbortSignal.timeout(5000)});
      if(!response.ok) throw new Error('provider');
      const data=await response.json();
      if(!Array.isArray(data.data)) throw new Error('malformed');
      const gifs=data.data.filter(g=>g && typeof g.id==='string' && /^[A-Za-z0-9]{1,100}$/.test(g.id) && g.rating==='g')
        .slice(0,8).map(g=>({id:g.id,title:typeof g.title==='string' && g.title.trim() ? Array.from(g.title.trim()).slice(0,200).join('') : 'GIF'}));
      res.json({gifs});
    }catch {
      sendError(req,res,503,'gif_unavailable','GIF search is unavailable. You can still send text messages.');
    }
  };
}
