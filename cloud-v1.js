/* B+ Gestionale HR — Supabase cloud bridge. Public key only; authorization is enforced by Supabase RLS/RPC. */
(function(){
'use strict';
const URL='https://ystiqoorxohqgrwefmgv.supabase.co';
const KEY='sb_publishable_Fcs5BU8QxytiUkfpe8Ii-A_UVlOulz_';
const client=window.supabase.createClient(URL,KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
let ready=false,pending=null,timer=null,saving=false,lastCallbacks=null;
function notify(message,kind){
 let el=document.getElementById('bplusCloudStatus');
 if(!el){el=document.createElement('div');el.id='bplusCloudStatus';el.style.cssText='position:fixed;right:14px;bottom:14px;z-index:100001;max-width:min(420px,calc(100vw - 28px));padding:10px 14px;border-radius:10px;background:#24262b;color:#fff;border:1px solid #454952;box-shadow:0 4px 18px #0008;font:600 13px/1.4 system-ui,sans-serif';document.body.appendChild(el)}
 el.textContent=message;el.style.borderColor=kind==='error'?'#d94b4b':kind==='ok'?'#348a56':'#8a8f98';el.style.display='block';
}
function roleNumber(role){return role==='titolare'?3:role==='responsabile'?2:1}
function mapSunday(v){return ({every_2:'ogni2',every_3:'ogni3',all:'tutte',none:'nessuna'})[v]||'ogni2'}
function mapStatus(v){return ({active:'attivo',absent:'assente',vacation:'ferie',sick:'malattia'})[v]||'attivo'}
async function profileFor(authUser){
 const {data:access,error:aerr}=await client.from('bplus_user_access').select('auth_user_id,employee_id,role,location_id,active').eq('auth_user_id',authUser.id).maybeSingle();
 if(aerr)throw aerr;if(!access||!access.active)throw new Error('Account autenticato ma non abilitato nel gestionale. Chiedi al titolare di assegnarti un ruolo.');
 const {data:locations,error:lerr}=await client.from('locations').select('id,code,name,active');
 if(lerr)throw lerr;
 const location=locations.find(x=>String(x.id)===String(access.location_id));
 if(!location)throw new Error('Punto vendita non assegnato al profilo.');
 let e=null;
 if(access.employee_id){
  const {data,error}=await client.rpc('bplus_get_app_state');
  if(error)throw error;
  e=(data?.employees||[]).find(x=>String(x.id)===String(access.employee_id));
  if(!e)throw new Error('Dipendente collegato al profilo non presente nel punto vendita assegnato.');
 }
 const owner=access.role==='titolare';
 const breakType=e?(e.pausaTipo||(e.break_type==='fixed'?'fissa':e.break_type==='flexible'?'flessibile':'flessibile')):'flessibile';
 const fixedRest=e?(e.riposiFissi||e.fixed_rest_days||[]):[];
 const compRest=e?(e.compensativi||e.sunday_comp_rest_days||[]):[];
 const mobility=e?(e.mobilita||locations.filter(x=>(e.mobile_location_ids||[]).map(String).includes(String(x.id))).map(x=>x.code)):[];
 const user=owner?{
  id:2,nome:authUser.user_metadata?.first_name||'Titolare',cognome:authUser.user_metadata?.last_name||'',
  email:authUser.email||'',telefono:'',ruolo:3,negozio:location.code,capacitaGenerale:5,comp:{},
  contratto:'',ore:0,pausa:'flessibile',pausaTipo:'flessibile',oreRecuperoBase:0,mobilita:locations.map(x=>x.code),
  stato:'attivo',inTurni:false
 }:{
  id:Number(e.id),nome:e.nome||e.first_name||'',cognome:e.cognome||e.last_name||'',email:e.email||authUser.email||'',
  telefono:e.telefono||e.phone||'',ruolo:roleNumber(access.role),negozio:e.negozio||location.code,
  capacitaGenerale:Number(e.capacitaGenerale??e.general_skill??1),
  comp:{tintometro:(e.comp?.tintometro??(e.tintometro?1:0))?1:0,chiavi:(e.comp?.chiavi??(e.keys_skill?1:0))?1:0,
   muletto:(e.comp?.muletto??(e.forklift_skill?1:0))?1:0,cassa:(e.comp?.cassa??(e.cash_skill?1:0))?1:0,
   taglio:(e.comp?.taglio??(e.wood_cut_skill?1:0))?1:0,kasanova:(e.comp?.kasanova??(e.kasanova_skill?1:0))?1:0},
  contratto:e.contratto||e.contract_type||'',ore:Number(e.ore??e.weekly_hours??0),pausa:breakType,pausaTipo:breakType,
  pausaInizio:e.pausaInizio||e.break_start||'',pausaFine:e.pausaFine||e.break_end||'',
  pausaMin:Number(e.pausaMin??e.break_minutes??0),policyDomeniche:e.policyDomeniche||mapSunday(e.sunday_policy),
  oreRecuperoBase:Number(e.oreRecuperoBase??e.recovery_hours??0),uscita18:!!(e.uscita18??e.exit_18_enabled),
  riposiFissi:fixedRest.map(String),compensativi:compRest.map(String),mobilita,
  stato:e.stato||mapStatus(e.employment_status),inTurni:!!(e.inTurni??e.include_in_shifts)
 };
 return {user,access,location,authUser};
}
async function signIn(email,password){
 const {data,error}=await client.auth.signInWithPassword({email:String(email||'').trim().toLowerCase(),password:String(password||'')});
 if(error)throw error;
 let profile;try{profile=await profileFor(data.user)}catch(e){await client.auth.signOut();throw e}
 if(window.BPlusAuth)window.BPlusAuth.set(profile.user,false);
 localStorage.setItem('bplus_cloud_required','1');
 return profile;
}
async function currentProfile(){
 const {data,error}=await client.auth.getUser();
 if(error||!data?.user)return null;
 const profile=await profileFor(data.user);
 if(window.BPlusAuth)window.BPlusAuth.set(profile.user,false);
 return profile;
}
function normalizeState(state){
 if(!state||typeof state!=='object'||Array.isArray(state))throw new Error('La risposta cloud non contiene dati B+ validi.');
 const defaults={employees:[],absences:[],shifts:[],notifications:[],stores:[],courses:[],attendance:[],board:[],audit:[],calendarEvents:[],shiftWeeks:{}};
 for(const [k,v] of Object.entries(defaults)){
  if(Array.isArray(v)&&!Array.isArray(state[k]))state[k]=v;
  else if(!Array.isArray(v)&&(!state[k]||typeof state[k]!=='object'||Array.isArray(state[k])))state[k]=v;
 }
 return state;
}
async function loadState(){
 const {data,error}=await client.rpc('bplus_get_app_state');
 if(error)throw error;
 return normalizeState(data);
}
async function flush(){
 if(!ready||!pending||saving)return;
 saving=true;const payload=pending;pending=null;
 try{
  const {error}=await client.rpc('bplus_save_app_state',{p_payload:payload});
  if(error)throw error;
  notify('Sincronizzazione cloud completata','ok');
 }catch(e){
  pending=payload;
  notify('Sincronizzazione non riuscita: '+(e.message||'errore di rete')+'. Riprovo automaticamente.','error');
  timer=setTimeout(flush,5000);
 }finally{
  saving=false;
  if(pending&&!timer)timer=setTimeout(flush,900);
 }
}
function scheduleSave(payload){
 if(!ready)return;
 try{pending=JSON.parse(JSON.stringify(payload));}catch(e){notify('Dati non sincronizzabili','error');return}
 if(timer)clearTimeout(timer);
 timer=setTimeout(flush,900);
}
async function inviteEmployee(employeeId){
 if(!ready)throw new Error('Accedi online come titolare prima di creare un account.');
 if(timer){clearTimeout(timer);timer=null}
 if(pending)await flush();
 const {data,error}=await client.functions.invoke('bplus-invite-user',{body:{employee_id:String(employeeId)}});
 if(error)throw error;
 if(!data?.ok)throw new Error(data?.error||'Invito non riuscito');
 return data;
}
async function sendMagicLink(email){
 const value=String(email||'').trim().toLowerCase();
 if(!value)throw new Error('Inserisci un indirizzo email.');
 const {error}=await client.auth.signInWithOtp({email:value,options:{shouldCreateUser:false,emailRedirectTo:'https://bricoplus.github.io/Bplus-new/'}});
 if(error)throw error;
 return true;
}
async function signOut(){ready=false;pending=null;if(timer)clearTimeout(timer);try{await client.auth.signOut()}catch(e){}localStorage.removeItem('bplus_cloud_required')}
function gate(show,message){
 const el=document.getElementById('bplusCloudGate');
 if(!el)return;
 if(message){const m=document.getElementById('bplusCloudGateMessage');if(m)m.textContent=message}
 el.hidden=!show;
}
async function initialize(callbacks){
 lastCallbacks=callbacks;
 const {data,error}=await client.auth.getSession();
 if(error)throw error;
 const session=data?.session;
 if(!session){
  const local=window.BPlusAuth&&window.BPlusAuth.get();
  if(local&&Number(local.user?.ruolo)!==3){
   window.BPlusAuth.clear();location.replace('./index.html?login=cloud-required');return false;
  }
  if(localStorage.getItem('bplus_cloud_required')==='1'){
   if(window.BPlusAuth)window.BPlusAuth.clear();
   location.replace('./index.html?login=required');return false;
  }
  gate(false);notify('Modalità locale: le modifiche non sono sincronizzate online.','error');return false;
 }
 gate(true,'Connessione sicura a Supabase…');
 const {data:authData,error:userError}=await client.auth.getUser();
 if(userError||!authData?.user)throw new Error('Sessione online scaduta. Accedi di nuovo.');
 const profile=await profileFor(authData.user);
 const local=window.BPlusAuth&&window.BPlusAuth.get();
 if(!local||String(local.user?.email||'').toLowerCase()!==String(profile.user.email||'').toLowerCase()||Number(local.user?.ruolo)!==Number(profile.user.ruolo)){
  if(window.BPlusAuth)window.BPlusAuth.set(profile.user,false);
  location.reload();return false;
 }
 const state=await loadState();
 callbacks.setDb(state);
 localStorage.setItem('bplus_new_v4',JSON.stringify(state));
 ready=true;
 callbacks.render();
 gate(false);
 notify('Collegato a Supabase · dati online attivi','ok');
 return true;
}
window.BPlusCloud={client,signIn,currentProfile,sendMagicLink,inviteEmployee,loadState,scheduleSave,signOut,initialize,isReady:()=>ready};
})();