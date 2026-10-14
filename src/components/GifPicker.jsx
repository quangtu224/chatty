import { useEffect, useRef, useState } from 'react';
import { searchGifs } from '../services/api.js';
import { gifUrl } from '../services/chat-model.js';

export default function GifPicker({query,onSelect,onCancel}) {
  const [gifs,setGifs]=useState([]),[error,setError]=useState(''),[loading,setLoading]=useState(!!query);
  const container=useRef(null);
  useEffect(()=>{
    let cancelled=false;
    setGifs([]);setError('');setLoading(!!query);
    if(!query) { setError('Add a search after /gif, for example /gif happy.'); return; }
    // Debounce keystrokes, and ignore replies from earlier keywords.
    const timer=setTimeout(()=>searchGifs(query).then(result=>{if(!cancelled)setGifs(result.gifs);})
      .catch(err=>{if(!cancelled)setError(err.message);})
      .finally(()=>{if(!cancelled)setLoading(false);}),400);
    return ()=>{cancelled=true;clearTimeout(timer);};
  },[query]);
  return <section className="gif-picker" aria-label="GIF picker" ref={container} onKeyDown={e=>{
    if(e.key==='Escape'){e.preventDefault();e.stopPropagation();onCancel();}
    if(['ArrowRight','ArrowLeft','ArrowDown','ArrowUp'].includes(e.key)) {
      const buttons=[...container.current.querySelectorAll('.gif-result')];
      const index=buttons.indexOf(document.activeElement);
      if(index>=0 && buttons.length) {
        e.preventDefault();
        buttons[(index+(['ArrowRight','ArrowDown'].includes(e.key)?1:buttons.length-1))%buttons.length].focus();
      }
    }
  }}>
    <div className="gif-picker-header"><strong>GIFs · {query || 'Search'}</strong><button className="text-button" onClick={onCancel}>Cancel (Esc)</button></div>
    <p role="status">{loading ? 'Searching GIFs…' : error || (gifs.length ? 'Keep typing to search · Arrow down to browse · Enter or click to send.' : 'No GIFs found. Try another search.')}</p>
    <div className="gif-results">{gifs.map(gif=><button key={gif.id} className="gif-result" aria-label={`Send GIF: ${gif.title}`} onClick={()=>onSelect(gif)}>
      <img src={gifUrl(gif.id)} alt={gif.title} loading="lazy" referrerPolicy="no-referrer" />
    </button>)}</div>
    <a className="giphy-attribution" href="https://giphy.com" target="_blank" rel="noreferrer">Powered by GIPHY</a>
  </section>;
}
