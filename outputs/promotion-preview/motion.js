// React Bits BlurText, TiltedCard, SpotlightCard, Magnet and LogoLoop inspired adaptations.
// Source and license are retained in the HTML and react-bits-LICENSE.md.
(() => {
  'use strict';
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  const finePointer = matchMedia('(hover: hover) and (pointer: fine)');
  const interactive = () => !reduce.matches && finePointer.matches && innerWidth > 800;
  const words = [...document.querySelectorAll('.motion-word')];
  const introAnimations = [];
  if (!reduce.matches) {
    words.forEach((word, index) => {
      if (typeof word.animate !== 'function') return;
      introAnimations.push(word.animate([
        { opacity:0, filter:'blur(8px)', transform:'translateY(19px)' },
        { opacity:.7, filter:'blur(3px)', transform:'translateY(-2px)', offset:.62 },
        { opacity:1, filter:'blur(0px)', transform:'translateY(0)' }
      ], { duration:760, delay:100 + index * 85, easing:'cubic-bezier(.22,.7,.25,1)', fill:'backwards' }));
    });
  }

  const spotlightCards = [...document.querySelectorAll('.service-card,.representative-card')];
  spotlightCards.forEach(card => {
    card.classList.add('motion-spotlight');
    let scheduled=0, point=null;
    const update = event => {
      if (!interactive() || event.pointerType==='touch') return;
      point={x:event.clientX,y:event.clientY};
      card.classList.add('is-pointer-active');
      if (scheduled) return;
      scheduled=requestAnimationFrame(() => {
        scheduled=0;
        if (!point || !interactive()) return;
        const bounds=card.getBoundingClientRect();
        card.style.setProperty('--pointer-x',`${point.x-bounds.left}px`);
        card.style.setProperty('--pointer-y',`${point.y-bounds.top}px`);
      });
    };
    card.addEventListener('pointerenter',update);
    card.addEventListener('pointermove',update);
    card.addEventListener('pointerleave',() => {
      point=null;
      cancelAnimationFrame(scheduled);
      scheduled=0;
      card.classList.remove('is-pointer-active');
    });
  });

  const phone = document.querySelector('.phone-window');
  let phoneFrame=0, phonePoint=null;
  function resetPhone() {
    phonePoint=null;
    cancelAnimationFrame(phoneFrame);
    phoneFrame=0;
    phone.classList.remove('is-pointer-active');
    ['--tilt-x','--tilt-y','--tilt-scale'].forEach(key=>phone.style.removeProperty(key));
  }
  phone.addEventListener('pointermove',event => {
    if (!interactive() || event.pointerType==='touch') return;
    phonePoint={x:event.clientX,y:event.clientY};
    if (phoneFrame) return;
    phoneFrame=requestAnimationFrame(() => {
      phoneFrame=0;
      if (!phonePoint || !interactive()) return;
      const bounds=phone.getBoundingClientRect();
      const x=Math.max(-1,Math.min(1,(phonePoint.x-bounds.left-bounds.width/2)/(bounds.width/2)));
      const y=Math.max(-1,Math.min(1,(phonePoint.y-bounds.top-bounds.height/2)/(bounds.height/2)));
      phone.classList.add('is-pointer-active');
      phone.style.setProperty('--tilt-x',`${(-y*5).toFixed(2)}deg`);
      phone.style.setProperty('--tilt-y',`${(x*6).toFixed(2)}deg`);
      phone.style.setProperty('--tilt-scale','1.025');
    });
  });
  phone.addEventListener('pointerleave',resetPhone);

  const magnets=[...document.querySelectorAll('.platform-button')];
  let magnetFrame=0, magnetPoint=null;
  function resetMagnets() {
    magnetPoint=null;
    cancelAnimationFrame(magnetFrame);
    magnetFrame=0;
    magnets.forEach(button => {
      button.style.removeProperty('--magnet-x');
      button.style.removeProperty('--magnet-y');
    });
  }
  document.addEventListener('pointermove',event => {
    if (!interactive() || event.pointerType==='touch') return;
    magnetPoint={x:event.clientX,y:event.clientY};
    if (magnetFrame) return;
    magnetFrame=requestAnimationFrame(() => {
      magnetFrame=0;
      if (!magnetPoint || !interactive()) return;
      if (document.querySelector('dialog[open]')) {resetMagnets();return;}
      magnets.forEach(button => {
        const bounds=button.parentElement.getBoundingClientRect();
        const dx=magnetPoint.x-bounds.left-bounds.width/2;
        const dy=magnetPoint.y-bounds.top-bounds.height/2;
        const near=bounds.bottom>0 && bounds.top<innerHeight && Math.abs(dx)<bounds.width/2+12 && Math.abs(dy)<bounds.height/2+12;
        const clamp=value=>Math.max(-7,Math.min(7,value/6));
        if (near) {
          button.style.setProperty('--magnet-x',`${clamp(dx).toFixed(2)}px`);
          button.style.setProperty('--magnet-y',`${clamp(dy).toFixed(2)}px`);
        } else {
          button.style.removeProperty('--magnet-x');
          button.style.removeProperty('--magnet-y');
        }
      });
    });
  },{passive:true});
  document.documentElement.addEventListener('pointerleave',resetMagnets);
  magnets.forEach(button=>button.addEventListener('click',resetMagnets));
  window.addEventListener('scroll',resetMagnets,{passive:true});
  window.addEventListener('blur',()=>{resetMagnets();resetPhone();});

  const loop=document.querySelector('.software-loop');
  const track=loop.querySelector('.software-loop-track');
  const sequence=track.querySelector('.software-list');
  const toggle=document.querySelector('.software-loop-toggle');
  toggle.hidden=reduce.matches;
  let loopPaused=false;
  function sizeLoop() {
    const width=sequence.getBoundingClientRect().width;
    if (!width) return;
    track.querySelectorAll('.software-list[aria-hidden="true"]').forEach(copy=>copy.remove());
    const copies=Math.max(2,Math.ceil(loop.clientWidth/width)+1);
    for(let i=1;i<copies;i++) {
      const copy=sequence.cloneNode(true);
      copy.setAttribute('aria-hidden','true');
      track.append(copy);
    }
    loop.style.setProperty('--loop-width',`${width}px`);
    loop.style.setProperty('--loop-duration',`${Math.max(26,width/28)}s`);
    loop.classList.add('is-loop-ready');
  }
  function syncLoop() {
    loop.classList.toggle('is-loop-paused',loopPaused || reduce.matches);
    toggle.hidden=reduce.matches;
    toggle.setAttribute('aria-pressed',String(loopPaused));
    toggle.setAttribute('aria-label',loopPaused?'继续软件名称滚动':'暂停软件名称滚动');
    toggle.title=loopPaused?'继续滚动':'暂停滚动';
  }
  toggle.addEventListener('click',()=>{loopPaused=!loopPaused;syncLoop();});
  sizeLoop();
  if (typeof ResizeObserver==='function') {
    const resize=new ResizeObserver(sizeLoop);
    resize.observe(loop);
    resize.observe(sequence);
  } else window.addEventListener('resize',sizeLoop);
  document.fonts?.ready.then(sizeLoop);
  if (typeof IntersectionObserver==='function') {
    const visible=new IntersectionObserver(entries=>{
      loop.classList.toggle('is-loop-offscreen',!entries[0].isIntersecting);
    },{threshold:0});
    visible.observe(loop);
  }
  document.addEventListener('visibilitychange',()=>{
    loop.classList.toggle('is-loop-hidden',document.hidden);
    if(document.hidden){resetPhone();resetMagnets();}
  });
  function refreshMotionPreference() {
    resetPhone();resetMagnets();
    spotlightCards.forEach(card=>card.classList.remove('is-pointer-active'));
    if(reduce.matches)introAnimations.forEach(animation=>animation.cancel());
    syncLoop();sizeLoop();
  }
  reduce.addEventListener('change',refreshMotionPreference);
  finePointer.addEventListener('change',refreshMotionPreference);
  window.addEventListener('resize',()=>{if(!interactive()){resetPhone();resetMagnets();}});
  syncLoop();
})();
