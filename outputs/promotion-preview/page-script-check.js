
    'use strict';
    // 上线时填写已核实的微信小程序 URL Link。留空时，页面提供可用的需求与入驻清单。
    const SITE_CONFIG = { miniappUrl: '' };
    const $ = (selector) => document.querySelector(selector);
    const $$ = (selector) => [...document.querySelectorAll(selector)];

    const comingDialog=$('#coming-dialog');let comingReturnFocus=null;
    function openComing(button,name,icon,isPlatform=false){comingReturnFocus=button;$('#coming-platform').textContent=name+(isPlatform?' 访问入口':'');$('#coming-icon').setAttribute('href','#'+icon);$('#coming-description').textContent=isPlatform?'感谢关注仿真通。更多访问方式，敬请期待。':'感谢关注仿真通。相关内容，敬请期待。';comingDialog.showModal();}
    $$('.platform-button').forEach(button=>button.addEventListener('click',()=>openComing(button,button.dataset.platform,button.dataset.platformIcon,true)));
    $$('[data-coming]').forEach(button=>button.addEventListener('click',()=>openComing(button,button.dataset.coming,button.dataset.comingIcon||'i-cube')));
    $('.coming-close').addEventListener('click',()=>comingDialog.close());$('.coming-confirm').addEventListener('click',()=>comingDialog.close());comingDialog.addEventListener('close',()=>comingReturnFocus?.focus());comingDialog.addEventListener('click',event=>{if(event.target===comingDialog){const bounds=comingDialog.getBoundingClientRect();if(event.clientX<bounds.left||event.clientX>bounds.right||event.clientY<bounds.top||event.clientY>bounds.bottom)comingDialog.close();}});
    const menuButton = $('.menu-toggle');
    function closeMenu(){ $('.nav').classList.remove('is-open'); menuButton.setAttribute('aria-expanded','false');menuButton.setAttribute('aria-label','展开导航'); }
    menuButton.addEventListener('click',()=>{const isOpen=$('.nav').classList.toggle('is-open');menuButton.setAttribute('aria-expanded',String(isOpen));menuButton.setAttribute('aria-label',isOpen?'收起导航':'展开导航');});
    $$('.nav a').forEach(link=>link.addEventListener('click',closeMenu));
    document.addEventListener('keydown',event=>{if(event.key==='Escape')closeMenu();});
    window.matchMedia('(min-width: 561px)').addEventListener('change',event=>{if(event.matches)closeMenu();});

    // 宣传稿演示数据。正式上线时可在此替换为真实统计或接入统计 API。
    const PLATFORM_DATA = {
      months:['2025/10','2025/11','2025/12','2026/01','2026/02','2026/03','2026/04','2026/05','2026/06','2026/07','2026/08','2026/09'],
      visits:[43000,52000,69000,78000,91000,108000,126000,168000,219000,257000,314000,386400],
      demands:[165,203,247,292,350,406,468,592,718,864,1055,1286],
      deliveries:[109,137,168,216,261,302,361,455,572,684,826,1048],
      domains:[{name:'结构分析',share:36,color:'#137b8b'},{name:'流体分析',share:28,color:'#58c9d1'},{name:'热分析',share:18,color:'#f28b5a'},{name:'电磁分析',share:10,color:'#7d91bb'},{name:'多物理场',share:8,color:'#a7bbcb'}]
    };
    const metricInfo={visits:{title:'访问量持续增长',subtitle:'每月平台访问次数',series:'平台访问量',unit:'次'},demands:{title:'更多需求，更多合作机会',subtitle:'每月新发布的仿真需求',series:'新增仿真需求',unit:'个'},deliveries:{title:'让更多项目抵达成果',subtitle:'每月完成交付验收的项目',series:'项目交付',unit:'项'}};
    let activeMetric='visits',activePeriod=6,dataRevealed=false;
    const reducedMotion=window.matchMedia('(prefers-reduced-motion: reduce)');
    const svgNS='http://www.w3.org/2000/svg';
    function svgElement(tag,attributes={},text){const node=document.createElementNS(svgNS,tag);for(const [key,value] of Object.entries(attributes))node.setAttribute(key,String(value));if(text!==undefined)node.textContent=text;return node;}
    function compactValue(value){return activeMetric==='visits'?(value/10000).toFixed(value%10000===0?0:1)+'万':value.toLocaleString('zh-CN');}
    function renderTrend(animate=false){
      const svg=$('#traffic-chart');const meta=metricInfo[activeMetric];const values=PLATFORM_DATA[activeMetric].slice(-activePeriod),months=PLATFORM_DATA.months.slice(-activePeriod);
      const left=57,right=796,top=24,bottom=239;
      const rawMax=Math.max(...values)*1.15;const targetStep=rawMax/4,magnitude=10**Math.floor(Math.log10(targetStep));const interval=[1,1.25,1.5,2,2.5,5,10].find(step=>step>=targetStep/magnitude)*magnitude;
      const maximum=interval*4;const points=values.map((value,i)=>({x:left+i*(right-left)/(values.length-1),y:bottom-value/maximum*(bottom-top),value,month:months[i]}));
      svg.replaceChildren(svgElement('title',{},`${meta.series}趋势，演示数据`));svg.setAttribute('aria-label',`${meta.series}趋势，${activePeriod}个月，演示数据`);
      const defs=svgElement('defs');const gradient=svgElement('linearGradient',{id:'traffic-fill',x1:0,y1:0,x2:0,y2:1});gradient.append(svgElement('stop',{offset:'0%','stop-color':'#58c9d1','stop-opacity':'.38'}),svgElement('stop',{offset:'100%','stop-color':'#58c9d1','stop-opacity':'.015'}));defs.append(gradient);svg.append(defs);
      for(let i=0;i<=4;i++){const y=bottom-i*(bottom-top)/4;svg.append(svgElement('line',{x1:left,y1:y,x2:right,y2:y,class:'chart-grid'}),svgElement('text',{x:left-12,y:y+4,'text-anchor':'end',class:'chart-label'},compactValue(maximum*i/4)));}
      const curve='M'+points.map(p=>`${p.x},${p.y}`).join(' L');const area=svgElement('path',{d:`${curve} L${right},${bottom} L${left},${bottom} Z`,fill:'url(#traffic-fill)'});const line=svgElement('path',{d:curve,class:'chart-line'});svg.append(area,line);
      points.forEach((point,i)=>{if(activePeriod===6||i%2===0||i===points.length-1){svg.append(svgElement('text',{x:point.x,y:bottom+30,'text-anchor':'middle',class:'chart-label'},Number(point.month.split('/')[1])+'月'));}const dot=svgElement('circle',{cx:point.x,cy:point.y,r:4.5,class:'chart-point'});svg.append(dot);const width=(right-left)/(points.length-1);const hit=svgElement('rect',{x:Math.max(left-18,point.x-width/2),y:top-8,width:i===0||i===points.length-1?width/2+18:width,height:bottom-top+20,tabindex:0,role:'button','aria-label':`${point.month}，${point.value.toLocaleString('zh-CN')}${meta.unit}`,class:'chart-hit'});
        const show=()=>{const tooltip=$('#chart-tooltip');tooltip.hidden=false;tooltip.querySelector('span').textContent=point.month.replace('/','年')+'月';tooltip.querySelector('strong').textContent=compactValue(point.value)+' '+meta.unit;tooltip.style.left=`${Math.max(15,Math.min(85,point.x/820*100))}%`;tooltip.style.top=`${Math.max(22,point.y/290*100-4)}%`;svg.querySelectorAll('.chart-point').forEach(el=>el.classList.remove('is-active'));dot.classList.add('is-active');};
        const hide=()=>{$('#chart-tooltip').hidden=true;dot.classList.remove('is-active');};hit.addEventListener('pointerenter',show);hit.addEventListener('pointerleave',hide);hit.addEventListener('focus',show);hit.addEventListener('blur',hide);hit.addEventListener('click',show);hit.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();show();}if(event.key==='Escape')hide();});svg.append(hit);});
      const growth=(values.at(-1)/values.at(-2)-1)*100;$('#chart-title').textContent=meta.title;$('#chart-subtitle').textContent=meta.subtitle;$('#chart-series-name').textContent=meta.series;$('#chart-growth').textContent='+'+growth.toFixed(1)+'%';$('#chart-tooltip').hidden=true;
      $('#chart-data-table caption').textContent=`${meta.series}，演示数据`;$('#chart-data-table tbody').replaceChildren(...points.map(point=>{const row=document.createElement('tr'),month=document.createElement('th'),value=document.createElement('td');month.scope='row';month.textContent=point.month;value.textContent=point.value.toLocaleString('zh-CN')+meta.unit;row.append(month,value);return row;}));
      if(animate&&!reducedMotion.matches){const length=line.getTotalLength();line.animate([{strokeDasharray:`${length} ${length}`,strokeDashoffset:length},{strokeDasharray:`${length} ${length}`,strokeDashoffset:0}],{duration:1100,easing:'cubic-bezier(.22,.7,.25,1)'});area.animate([{opacity:0},{opacity:1}],{duration:1000});}
    }
    function renderDonut(animate=false){const svg=$('#demand-donut'),radius=83,circumference=2*Math.PI*radius;svg.replaceChildren(svgElement('circle',{cx:110,cy:110,r:radius,fill:'none',stroke:'#e9f0f3','stroke-width':20}));let offset=0;PLATFORM_DATA.domains.forEach(domain=>{const length=domain.share/100*circumference-4;const segment=svgElement('circle',{cx:110,cy:110,r:radius,fill:'none',stroke:domain.color,'stroke-width':20,'stroke-dasharray':`${length} ${circumference-length}`,'stroke-dashoffset':-offset});svg.append(segment);if(animate&&!reducedMotion.matches)segment.animate([{'stroke-dasharray':`0 ${circumference}`},{'stroke-dasharray':`${length} ${circumference-length}`}],{duration:1150,easing:'cubic-bezier(.22,.7,.25,1)'});offset+=domain.share/100*circumference;});}
    function animateCounters(){const elements=$$('[data-counter]'),start=performance.now(),duration=reducedMotion.matches?0:1350;const frame=now=>{const fraction=duration?Math.min(1,(now-start)/duration):1,eased=1-(1-fraction)**3;elements.forEach(element=>{const value=Number(element.dataset.counter)*eased;element.textContent=element.dataset.format==='wan'?(value/10000).toFixed(1):Math.round(value).toLocaleString('zh-CN');});if(fraction<1)requestAnimationFrame(frame);};requestAnimationFrame(frame);}
    $$('[data-metric]').forEach(button=>button.addEventListener('click',()=>{activeMetric=button.dataset.metric;$$('[data-metric]').forEach(item=>item.setAttribute('aria-pressed',String(item===button)));renderTrend(true);}));
    $$('[data-period]').forEach(button=>button.addEventListener('click',()=>{activePeriod=Number(button.dataset.period);$$('[data-period]').forEach(item=>item.setAttribute('aria-pressed',String(item===button)));renderTrend(true);}));
    renderTrend();renderDonut();
    function revealData(){if(dataRevealed)return;dataRevealed=true;animateCounters();renderTrend(true);renderDonut(true);}
    if(typeof IntersectionObserver!=='undefined'){const observer=new IntersectionObserver(entries=>{if(entries.some(entry=>entry.isIntersecting)){revealData();observer.disconnect();}},{threshold:.13});observer.observe($('#platform-data'));}else revealData();
    const stages=[{status:'需求准备',rows:[['分析目标','强度校核与变形评估'],['基础资料','三维模型、材料与工况'],['期望交付','分析报告与约定成果']],note:'把边界条件与交付要求写清楚，让工程师更准确地评估项目。'},{status:'方案比选',rows:[['报价金额','了解费用及覆盖范围'],['承诺工期','结合项目排期选择'],['技术方案','对照方法、工况与交付内容']],note:'查看工程师资料与公开案例，再结合方案选择合作伙伴。'},{status:'项目执行',rows:[['合作确认','选定报价后完成微信支付'],['在线沟通','确认模型、工况与分析细节'],['交付期限','按成交报价记录项目截止时间']],note:'项目资料与沟通留在订单里。需要延期时，由双方确认申请。'},{status:'交付与验收',rows:[['接收成果','下载文件或查看交付链接'],['核对内容','检查双方约定的交付成果'],['完成验收','确认验收并留下服务评价']],note:'围绕约定交付内容完成核对，让一次专业协作形成完整记录。'}];
    $$('.step-btn').forEach(button=>button.addEventListener('click',()=>{const index=Number(button.dataset.step),stage=stages[index];$$('.step-btn').forEach(item=>item.setAttribute('aria-pressed',String(item===button)));$('#demo-status').textContent=stage.status;$('#demo-list').replaceChildren(...stage.rows.map(([label,value])=>{const row=document.createElement('div');row.className='demo-row';const left=document.createElement('span'),right=document.createElement('strong');left.textContent=label;right.textContent=value;row.append(left,right);return row;}));$('#demo-note').textContent=stage.note;$$('.demo-progress i').forEach((item,i)=>item.classList.toggle('done',i<=index));}));
    const dialog=$('#entry-dialog');let returnFocus=null;
    $$('[data-entry]').forEach(button=>button.addEventListener('click',()=>{const isCustomer=button.dataset.entry==='customer';returnFocus=button;$('#customer-entry').hidden=!isCustomer;$('#engineer-entry').hidden=isCustomer;$('#dialog-title').textContent=isCustomer?'准备你的仿真需求':'成为工程师，从这里开始';$('#dialog-intro').textContent=isCustomer?'把关键信息整理成一份清单，带到微信小程序中发布，让工程师更快了解你的项目。':'在微信小程序中建立专业资料，找到与你专长匹配的需求。';$('#form-feedback').textContent='';dialog.showModal();}));
    $('.dialog-close').addEventListener('click',()=>dialog.close());dialog.addEventListener('click',event=>{if(event.target===dialog){const b=dialog.getBoundingClientRect();if(event.clientX<b.left||event.clientX>b.right||event.clientY<b.top||event.clientY>b.bottom)dialog.close();}});dialog.addEventListener('close',()=>{returnFocus?.focus();});
    if(SITE_CONFIG.miniappUrl){try{const url=new URL(SITE_CONFIG.miniappUrl);if(url.protocol==='https:'){$('#miniapp-link').href=url.href;$('#miniapp-entry').hidden=false;}}catch{}}
    const briefForm=$('#brief-form');function briefText(){const data=new FormData(briefForm);return ['仿真项目需求清单',`项目名称：${String(data.get('project')).trim()}`,`仿真方向：${data.get('direction')}`,`期望软件：${String(data.get('software')).trim()||'与工程师协商'}`,`项目预算：${String(data.get('budget')).trim()||'与工程师协商'}`,`期望工期：${String(data.get('timeline')).trim()||'与工程师协商'}`,`分析目标与期望交付：\n${String(data.get('goal')).trim()}`,`已有资料：${String(data.get('materials')).trim()||'待补充'}`,'','请在仿真通微信小程序中发布需求，并提交必要的模型与工况资料。'].join('\n');}
    function validateBrief(){if(!briefForm.reportValidity())return false;for(const name of ['project','goal']){const input=briefForm.elements.namedItem(name);if(!input.value.trim()){input.setCustomValidity('请填写项目内容，不能只输入空格。');input.reportValidity();return false;}}return true;}
    briefForm.addEventListener('input',event=>{event.target.setCustomValidity?.('');$('#form-feedback').textContent='';});
    function downloadText(content,name){const url=URL.createObjectURL(new Blob([String.fromCharCode(0xfeff),content],{type:'text/plain;charset=utf-8'}));const anchor=document.createElement('a');anchor.href=url;anchor.download=name;document.body.append(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),1500);}
    briefForm.addEventListener('submit',async event=>{event.preventDefault();if(!validateBrief())return;const text=briefText();try{if(!navigator.clipboard?.writeText)throw new Error('Clipboard unavailable');await navigator.clipboard.writeText(text);$('#form-feedback').textContent='需求清单已复制，可在小程序发布需求时粘贴。';}catch{downloadText(text,'仿真项目需求清单.txt');$('#form-feedback').textContent='浏览器未开放复制权限，已为你下载文本清单。';}});
    $('#download-brief').addEventListener('click',()=>{if(validateBrief()){downloadText(briefText(),'仿真项目需求清单.txt');$('#form-feedback').textContent='需求清单已生成，请保存后在小程序中发布。';}});
    $('#download-guide').addEventListener('click',()=>{downloadText('仿真通工程师入驻清单\n\n1. 在微信小程序中选择工程师身份，建立资料并完成身份认证。\n2. 填写专业方向、擅长软件与个人介绍。\n3. 在接单大厅筛选合适的需求，提交报价金额、工期与技术方案。\n4. 被客户选中并付款后，在线沟通并按约定交付。\n5. 完成订单后，可在取得必要展示授权的前提下添加公开案例。\n6. 如双方希望持续合作，可确认长期合作条件并发起定向需求。','仿真通工程师入驻清单.txt');$('#form-feedback').textContent='入驻清单已生成，准备好资料后在小程序中继续。';});
// REACT_BITS_MOTION_START
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

// REACT_BITS_MOTION_END
  