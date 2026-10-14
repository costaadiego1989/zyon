// The landing's cinematic experience starts on the canonical URL itself.
// An explicit reduce/system preview affects this visit only.
(()=>{
 const allowed=['full','reduce','system'];
 const requested=new URLSearchParams(location.search).get('motion');
 // The requested public default is the full experience, including when the
 // operating system has disabled animations. Never persist URL previews.
 const preference=allowed.includes(requested)?requested:'full';
 window.__zyonMotionPreference=preference;
 document.documentElement.dataset.motionPreference=preference;
 document.documentElement.classList.toggle('motion-full',preference==='full');
 document.documentElement.classList.toggle('motion-reduced',preference==='reduce');
})();
