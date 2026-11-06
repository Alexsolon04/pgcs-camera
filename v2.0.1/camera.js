'use strict';
const options=new URLSearchParams(location.hash.slice(1)),channel=options.get('channel')||'',parentOrigin=options.get('origin')||'';
const status=document.querySelector('#status'),authorize=document.querySelector('#authorize'),consent=document.querySelector('#consent'),preview=document.querySelector('#preview'),stop=document.querySelector('#stop');
const CONSENT='PGCS_AV_SCREEN_V3';
let monitorDetails=null;
let screenStream=null,rawCamera=null,drawTimer=null;let stream=null,recorder=null,active=false,offset=0,deadline=Infinity,segment=0,total=0,deadlineTimer=null,converting=0,lastParentAck=Date.now();
const valid=/^[a-f0-9]{32}$/.test(channel)&&/^https:\/\/[a-z0-9-]+-script\.googleusercontent\.com$/.test(parentOrigin)&&!!window.opener;
function send(type,payload,transfers){if(valid)window.opener.postMessage({pgcsCamera:1,channel,type,consentVersion:CONSENT,screen:true,...payload},parentOrigin,transfers||[]);}
function say(text,recording){status.textContent=text;status.classList.toggle('recording',!!recording);}
function hasTracks(){return !!stream&&stream.getVideoTracks().length>0&&stream.getAudioTracks().length>0&&stream.getTracks().every(t=>t.readyState!=='ended'&&t.enabled!==false);}
function releaseTracks(){clearInterval(drawTimer);for(const s of [stream,screenStream,rawCamera])if(s)s.getTracks().forEach(t=>t.stop());}
function fail(error){active=false;clearTimeout(deadlineTimer);if(recorder&&recorder.state!=='inactive')recorder.stop();releaseTracks();say('Captura interrompida: '+(error.message||error));send('ERROR',{reason:String(error.message||error)});authorize.disabled=!consent.checked;}
function mimeType(){for(const type of ['video/webm;codecs=vp8,opus','video/webm','video/mp4'])if(MediaRecorder.isTypeSupported(type))return type;throw Error('Este navegador não oferece gravação audiovisual compatível.');}
async function authorizeCamera(){
 if(!valid||!consent.checked)return;authorize.disabled=true;
 try{if(!window.MediaRecorder)throw Error('Gravação não suportada neste navegador.');
 releaseTracks();if(!navigator.mediaDevices.getDisplayMedia)throw Error('Use computador com compartilhamento de tela compatível.');screenStream=await navigator.mediaDevices.getDisplayMedia({video:{displaySurface:'monitor',frameRate:{ideal:5,max:8}},audio:false});if(screenStream.getVideoTracks()[0].getSettings().displaySurface!=='monitor')throw Error('Selecione a tela inteira.');rawCamera=await navigator.mediaDevices.getUserMedia({video:{width:{ideal:480,max:640},height:{ideal:360,max:480},frameRate:{ideal:5,max:8}},audio:{echoCancellation:true,noiseSuppression:true}});
 if(!navigator.mediaDevices.getDisplayMedia)throw Error('Gravação de tela exige computador e navegador compatíveis.');
 if(screenStream.getVideoTracks()[0].getSettings().displaySurface!=='monitor')throw Error('Selecione a tela inteira; aba ou janela não são suficientes.');
 const desktop=document.createElement('video'),webcam=document.createElement('video');desktop.muted=webcam.muted=true;desktop.srcObject=screenStream;webcam.srcObject=rawCamera;await Promise.all([desktop.play(),webcam.play()]);
 const canvas=document.createElement('canvas');canvas.width=1600;canvas.height=900;const ctx=canvas.getContext('2d');
 const draw=()=>{ctx.fillStyle='#102b38';ctx.fillRect(0,0,1600,900);const scale=Math.min(1360/desktop.videoWidth,900/desktop.videoHeight);if(Number.isFinite(scale))ctx.drawImage(desktop,0,0,desktop.videoWidth*scale,desktop.videoHeight*scale);ctx.drawImage(webcam,1360,50,240,180);ctx.fillStyle='white';ctx.font='16px sans-serif';ctx.fillText('WEBCAM / MICROFONE',1365,30);ctx.fillText(new Date().toISOString(),1365,260);};draw();drawTimer=setInterval(draw,200);stream=canvas.captureStream(5);rawCamera.getAudioTracks().forEach(t=>stream.addTrack(t));
 for(const t of [...screenStream.getTracks(),...rawCamera.getTracks()])t.addEventListener('ended',()=>fail(Error('Compartilhamento da tela, câmera ou microfone interrompido.')));
 if(!hasTracks())throw Error('Autorize câmera, microfone e tela.');
 mimeType();preview.srcObject=stream;await preview.play();
 for(const track of stream.getTracks())track.addEventListener('ended',()=>{if(active)fail(Error('Câmera ou microfone desconectado. Retorne à prova e reconecte.'));});
 lastParentAck=Date.now();say('Webcam, microfone e tela verificados. Aguardando início da prova.');send('READY',{audio:true,video:true,synthetic:false});
 }catch(e){fail(e);}
}
function beginSegment(){
 if(!active)return;if(!hasTracks()){fail(Error('Câmera ou microfone indisponível.'));return;}if(Date.now()+offset>=deadline){finishCapture('PRAZO_ENCERRADO');return;}
 const parts=[],start=Date.now()+offset,current=new MediaRecorder(stream,{mimeType:mimeType(),videoBitsPerSecond:500000,audioBitsPerSecond:32000});recorder=current;let bytes=0,rotating=false;
 current.addEventListener('start',()=>{send('STARTED',{audio:true,video:true,synthetic:false});say('● GRAVAÇÃO EM ANDAMENTO — áudio e vídeo',true);});
 current.addEventListener('dataavailable',event=>{if(event.data.size){parts.push(event.data);bytes+=event.data.size;}if(current.state==='recording'&&!rotating&&(Date.now()+offset-start>=60000||bytes>=2*1024*1024)){rotating=true;current.stop();}});
 current.addEventListener('error',event=>fail(event.error||Error('Falha no gravador.')));
 current.addEventListener('stop',async()=>{
  converting++;const end=Math.min(Date.now()+offset,deadline),blob=new Blob(parts,{type:current.mimeType}),id=crypto.randomUUID();
  try{if(active)beginSegment();if(blob.size){if(blob.size>4*1024*1024)throw Error('Segmento excedeu 4 MiB. Reconecte com navegador compatível.');const buffer=await blob.arrayBuffer();segment++;total+=blob.size;document.querySelector('#counts').textContent=segment+' segmento(s) capturado(s), '+(total/1024/1024).toFixed(1)+' MiB. Confira o envio na prova.';send('SEGMENT',{id,mime:blob.type,buffer,startedAt:new Date(start).toISOString(),endedAt:new Date(end).toISOString()},[buffer]);}}
  catch(e){fail(e);}finally{converting--;if(!active&&converting===0)send('STOPPED',{segments:segment});}
 });
 current.start(3000);stop.hidden=false;
}
function finishCapture(reason){active=false;clearTimeout(deadlineTimer);if(recorder&&recorder.state!=='inactive')recorder.stop();else if(!converting)send('STOPPED',{segments:segment});releaseTracks();authorize.disabled=!consent.checked;stop.hidden=true;say('Gravação encerrada. Aguarde a confirmação de envio na prova.');send('STOPPING',{reason});}
window.addEventListener('message',event=>{const m=event.data;if(!valid||event.source!==window.opener||event.origin!==parentOrigin||!m||m.pgcsCamera!==1||m.channel!==channel)return;
 if(m.type==='ARM'){if(m.consentVersion!==CONSENT||!hasTracks()){fail(Error('Verifique os dispositivos antes de iniciar.'));return;}offset=Number(m.serverOffset)||0;deadline=Date.now()+offset+30000;if(active){send('STARTED',{audio:true,video:true,synthetic:false});return;}active=true;deadlineTimer=setTimeout(()=>finishCapture('INICIO_NAO_CONFIRMADO'),30000);try{beginSegment();}catch(e){fail(e);}}
 else if(m.type==='CHECK_MONITORS')reportMonitors();
 else if(m.type==='MONITOR_GATE'){document.querySelector('#monitorStatus').textContent=m.ok?'Verificação aceita'+(m.exception?' por exceção docente registrada.':'.'):m.status==='MULTIPLE'?'Desconecte os monitores estendidos antes de iniciar.':'Verificação pendente; regularize ou solicite exceção docente.';}
 else if(m.type==='START'){if(m.consentVersion!==CONSENT||!hasTracks()){fail(Error('Verifique câmera e microfone novamente.'));return;}offset=Number(m.serverOffset)||0;deadline=Number(m.deadline);if(!Number.isFinite(deadline)){fail(Error('Prazo de captura inválido.'));return;}clearTimeout(deadlineTimer);if(active){deadlineTimer=setTimeout(()=>finishCapture('PRAZO_ENCERRADO'),Math.max(0,deadline-Date.now()-offset));send('STARTED',{audio:true,video:true,synthetic:false});return;}active=true;deadlineTimer=setTimeout(()=>finishCapture('PRAZO_ENCERRADO'),Math.max(0,deadline-Date.now()-offset));try{beginSegment();}catch(e){fail(e);}}
 else if(m.type==='STOP')finishCapture('ENTREGA_REGISTRADA');
 else if(m.type==='RETURN_TARGET'){const link=document.querySelector('#returnExam');link.removeAttribute('href');link.removeAttribute('target');link.setAttribute('aria-disabled','false');}
 else if(m.type==='RETURN_ACK'){document.querySelector('#returnStatus').textContent='Conexão com a prova confirmada. Se a aba não vier à frente, selecione a aba Prova PGCS 2026/2. Esta janela deve permanecer aberta para a gravação.';}
 else if(m.type==='PARENT_ACK')lastParentAck=Date.now();
 else if(m.type==='PING')send('PONG',{ready:hasTracks(),audio:hasTracks(),video:hasTracks()});
});
setInterval(()=>{if(!stream||!hasTracks()){if(active)fail(Error('Câmera ou microfone interrompido.'));return;}if(window.opener.closed||Date.now()-lastParentAck>30000){fail(Error('A janela da prova deixou de confirmar a conexão. Reconecte pela prova.'));return;}if(!active){send('READY_HEARTBEAT',{audio:true,video:true,synthetic:false});return;}if(!hasTracks()){fail(Error('Câmera ou microfone interrompido.'));return;}if(recorder&&recorder.state==='recording')send('ALIVE',{audio:true,video:true,synthetic:false});},5000);
consent.onchange=()=>authorize.disabled=!valid||!consent.checked;authorize.onclick=authorizeCamera;stop.onclick=()=>finishCapture('INTERRUPCAO_VOLUNTARIA');
document.querySelector('#returnExam').onclick=event=>{event.preventDefault();if(!valid)return;send('RETURN_TO_EXAM',{});try{window.opener.top.focus();}catch(e){try{window.opener.focus();}catch(ignored){}}document.querySelector('#returnStatus').textContent='Selecione a janela Prova PGCS se o navegador não alternar. Mantenha esta janela aberta.';};
window.addEventListener('beforeunload',event=>{if(active){event.preventDefault();event.returnValue='';}});
if(!valid){consent.disabled=true;say('Abra esta página pelo botão da prova. Nenhum dispositivo foi ativado.');}send('HELLO',{audio:true,video:true});


/** API informa telas estendidas. Não comprova ausência de espelhadores ou dispositivos externos. */
function reportMonitors(denied){
 const count=monitorDetails?monitorDetails.screens.length:null;
 const report={count,extended:window.screen.isExtended===true,denied:!!denied};
 send('MONITORS',{report});
 if(active&&(count>1||report.extended))say('Monitor estendido detectado. Regularize a configuração; gravação e prazo continuam.',true);
 return report;
}
async function verifyMonitors(){
 try{
  if(typeof window.getScreenDetails!=='function'){reportMonitors(false);document.querySelector('#monitorStatus').textContent='Verificação completa indisponível. Solicite exceção docente; não será inferida pela resolução.';return;}
  if(!monitorDetails){monitorDetails=await window.getScreenDetails();monitorDetails.addEventListener('screenschange',()=>reportMonitors());monitorDetails.addEventListener('currentscreenchange',()=>reportMonitors());}
  reportMonitors();
 }catch(e){reportMonitors(e.name==='NotAllowedError');document.querySelector('#monitorStatus').textContent='Permissão não concedida ou API indisponível. Regularize ou solicite exceção docente.';}
}
document.querySelector('#verifyMonitors').onclick=verifyMonitors;
if(window.screen.addEventListener)window.screen.addEventListener('change',()=>reportMonitors());
