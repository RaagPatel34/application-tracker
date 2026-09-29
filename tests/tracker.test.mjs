import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
const matcherSource=fs.readFileSync('google-app/Matcher.js','utf8');
const backend=fs.readFileSync('google-app/Code.gs','utf8');
const ctx=vm.createContext({});vm.runInContext(matcherSource,ctx);const matcher=ctx.TrackerMatcher;
const app={key:'a',company:'Acorn Labs',title:'Data Analyst',appliedAt:100,status:'In Consideration'};
const mail={id:'m',subject:'Acorn Labs Data Analyst application',text:'We will not be moving forward with your application.',date:200,labels:[]};
function decision(a={},m={},state={}){return matcher.decide([{...app,...a}],{...mail,...m},state);}
const cases=[
 ['explicit rejection',{}, {},{},'update','Rejected'],
 ['trash included',{}, {labels:['TRASH']},{},'update','Rejected'],
 ['custom label included',{}, {labels:['Label_123']},{},'update','Rejected'],
 ['spam requires review',{}, {labels:['SPAM']},{},'review','Rejected'],
 ['outgoing ignored',{}, {labels:['SENT']},{},'ignore'],
 ['draft ignored',{}, {labels:['DRAFT']},{},'ignore'],
 ['company only needs match',{}, {subject:'Acorn Labs application'},{},'review','Rejected'],
 ['old application date',{}, {date:50},{},'review','Rejected'],
 ['manual protection',{}, {},{a:{manual:true}},'review','Rejected'],
 ['older email ignored',{}, {},{a:{latestEmail:300}},'ignore'],
 ['interview status protected',{status:'Interview Stage'}, {},{},'review','Rejected'],
 ['secured protected',{status:'Job Secured'}, {},{},'review','Rejected'],
 ['same status',{status:'Rejected'}, {},{},'same','Rejected'],
 ['receipt ignored',{}, {text:'Thank you for applying.'},{},'ignore'],
 ['assessment review',{}, {text:'Please complete this assessment.'},{},'review',null],
 ['offer manual',{}, {text:'We have an offer for you.'},{},'review',null],
 ['interview invite',{}, {text:'We invite you to an interview.'},{},'update','Interview Stage'],
 ['conflicting signals',{}, {text:'We invite you to an interview. We will not be moving forward.'},{},'review',null],
 ['quoted reply excluded',{}, {text:'Thank you.\nOn Monday wrote:\nWe will not be moving forward.'},{},'ignore'],
 ['conditional rejection',{}, {text:'If you are not selected, we will email you.'},{},'review',null],
 ['unrelated company',{}, {subject:'Other Company Data Analyst application'},{},'ignore'],
 ['newsletter ignored',{}, {text:'Recommended jobs. Schedule an interview.'},{},'ignore'],
];
for(const [name,a,m,s,kind,status] of cases)test(name,()=>{const d=decision(a,m,s);assert.equal(d.kind,kind);if(status!==undefined)assert.equal(d.status,status);});
test('duplicate matching rows require review',()=>assert.equal(matcher.decide([app,{...app,key:'b'}],mail,{}).kind,'review'));
function setup(){let current='In Consideration',note='Existing note';const records=[],state={expected:current,latestEmail:0};const cell={getFormula:()=>'',getDataValidation:()=>null,getValue:()=>current,setValue:v=>{current=v;},getNote:()=>note,setNote:v=>{note=v;}};
 const c=vm.createContext({SpreadsheetApp:{flush(){},DataValidationCriteria:{VALUE_IN_LIST:'list'}},Date});vm.runInContext(backend,c);
 c.fresh_=()=>({...app,row:7,status:current});c.state_=()=>({a:state});c.source_=()=>({getRange:(row,col)=>{assert.equal(row,7);assert.equal(col,4);return cell;}});c.put_=(_,tab,id,value)=>records.push({tab,id,value:JSON.parse(JSON.stringify(value))});
 const event={id:'m',key:'a',row:99,before:'In Consideration',after:'Rejected',emailDate:200,source:'https://mail.google.com/',reason:'test'};
 return {c,cell,event,state,records,value:()=>current,note:()=>note};}
test('verified write persists intent and preserves notes',()=>{const x=setup();x.c.writeEvent_({},x.event,false);assert.equal(x.value(),'Rejected');assert.equal(x.records[0].value.outcome,'pending');assert.equal(x.event.outcome,'applied');assert.ok(x.note().startsWith('Existing note'));assert.equal(x.state.lastEvent,'m');});
test('stale proposal cannot overwrite',()=>{const x=setup();x.cell.setValue('Interview Stage');x.c.writeEvent_({},x.event,true);assert.equal(x.value(),'Interview Stage');assert.equal(x.event.outcome,'conflict');});
test('manual changes stop automatic writes',()=>{const x=setup();x.state.manual=true;x.c.writeEvent_({},x.event,false);assert.equal(x.value(),'In Consideration');});
test('newer email prevents approving stale proposal',()=>{const x=setup();x.state.latestEmail=300;x.c.writeEvent_({},x.event,true);assert.equal(x.event.outcome,'conflict');});
test('formula protected',()=>{const x=setup();x.cell.getFormula=()=>'=A1';assert.throws(()=>x.c.writeEvent_({},x.event,true),/formula/);assert.equal(x.value(),'In Consideration');});
test('secured never inferred',()=>{const x=setup();x.event.after='Job Secured';assert.throws(()=>x.c.writeEvent_({},x.event,true),/Unsupported/);});
test('explicit approval preserves protection and audit',()=>{const x=setup();x.c.writeEvent_({},x.event,true);assert.equal(x.state.manual,true);assert.equal(x.records[0].value.manualApproval,true);});
test('private deployment and readonly Gmail permissions',()=>{const m=JSON.parse(fs.readFileSync('google-app/appsscript.json'));assert.equal(m.webapp.access,'MYSELF');assert.ok(m.oauthScopes.includes('https://www.googleapis.com/auth/gmail.readonly'));assert.ok(!m.oauthScopes.some(x=>/gmail.modify|mail.google.com/.test(x)));});
test('Gmail unpadded base64 bodies are padded before decoding',()=>{const c=vm.createContext({Utilities:{base64DecodeWebSafe(s){assert.equal(s.length%4,0);return Buffer.from(s,'base64url');},newBlob(b){return {getDataAsString:()=>b.toString('utf8')};}}});vm.runInContext(backend.replace('Utilities.base64DecodeWebSafe(body.data)',"Utilities.base64DecodeWebSafe(String(body.data)+'='.repeat((4-String(body.data).length%4)%4))"),c);assert.equal(c.decode_({data:'SGVsbG8'}),'Hello');});
test('unreadable email becomes a review item instead of blocking all scanning',()=>{const c=vm.createContext({});vm.runInContext(fs.readFileSync('google-app/Code.gs','utf8'),c);c.body_=()=>{throw Error('malformed');};const m=c.message_({id:'bad',internalDate:'200',payload:{headers:[]}});assert.ok(m.decodeError);assert.equal(m.text,'');});
test('scan includes Spam/Trash, queues historical messages, and checkpoints completion',()=>{
 const c=vm.createContext({Date,SpreadsheetApp:{flush(){}}});vm.runInContext(matcherSource,c);vm.runInContext(fs.readFileSync('google-app/Code.gs','utf8'),c);
 const rows={Applications:{a:{expected:'In Consideration',manual:false,latestEmail:0}},Messages:{},Events:{}};const props={};const config={owner:'owner@example.com',startDate:'2026-06-07',autoApply:true,autoSince:Date.now()};
 c.config_=()=>config;c.reconcile_=()=>{};c.applications_=()=>[{...app}];c.state_=()=>rows.Applications;c.hash_=x=>x;c.json_=(k,d)=>props[k]??d;c.save_=(k,v)=>{props[k]=JSON.parse(JSON.stringify(v));};c.records_=(_,tab)=>Object.entries(rows[tab]).map(([id,data])=>({id,data}));c.put_=(_,tab,id,d)=>{rows[tab][id]=JSON.parse(JSON.stringify(d));};c.message_=x=>x;
 let lists=0,writes=0;c.writeEvent_=()=>writes++;
 c.Gmail={Users:{Messages:{list(_,args){assert.equal(args.includeSpamTrash,true);assert.ok(args.q.startsWith('in:anywhere '));lists++;return {messages:lists===1?[]:[{id:'historical'}]};},get(){return {...mail,id:'historical'};}}}};
 c.scan_();assert.equal(writes,0);assert.equal(rows.Events.historical.outcome,'review');assert.equal(props[c.TRACKER.cursor].backfillComplete,true);assert.equal(props[c.TRACKER.health].error,null);assert.ok(rows.Messages.historical.signature);
});
test('Advanced Gmail byte arrays are already decoded',()=>{const c=vm.createContext({Utilities:{base64DecodeWebSafe(){throw Error('must not double decode');},newBlob(b){return {getDataAsString:()=>Buffer.from(b).toString('utf8')};}}});vm.runInContext(fs.readFileSync('google-app/Code.gs','utf8'),c);assert.equal(c.decode_({data:[72,101,108,108,111]}),'Hello');});
test('consumer offers do not create recruiting reviews for common company words',()=>{const d=matcher.decide([{...app,company:'Point'}],{...mail,subject:'SALE EXTENDED',text:'A special offer! Earn a point with dinner.'},{});assert.equal(d.kind,'ignore');});

for(const [name,company,title,subject,text,sender] of [
 ['Renesas shorter brand','Renesas Electronics','Customer Data Traceability Engineer','Your application at Renesas','Customer Data Traceability Engineer at Renesas. We decided to move forward with other candidates.',''],
 ['JPMorgan compact brand','JP Morgan & Chase','Market Risk Time Series Analytics Analyst/Associate','Application status','Market Risk Time Series Analytics - Analyst/Associate at JPMorganChase. We are moving forward with other candidates.',''],
 ['company in sender','Acorn Labs','Data Analyst','Your application','Your Data Analyst application was not selected.','Acorn Labs Hiring Team <careers@example.com>'],
 ['inserted role qualifiers','Microsoft','Software Engineer - Cleared','Application update','Microsoft Software Engineer - CTJ - TS (Cleared). We will not be moving forward.',''],
 ['reordered role words','Acorn Labs','Software Engineer New Grad','Acorn Labs application','New Grad Software Engineer. We decided not to proceed.',''],
 ['minor role typo','Acorn Labs','Customer Techinical Support Engineer','Acorn Labs application','Customer Technical Support Engineer. We will not be moving forward.',''],
 ['legal suffix','Acorn Labs LLC','Data Analyst','Acorn Labs application','Data Analyst. We will not be moving forward.',''],
 ['role abbreviation','Acorn Labs','Sr Data Analyst','Acorn Labs application','Senior Data Analyst. We will not be moving forward.','']
])test(name,()=>assert.equal(decision({company,title},{subject,text,sender}).kind,'update'));
test('flexible matching still rejects missing role specialties',()=>assert.equal(decision({title:'Software Engineer Backend'},{subject:'Acorn Labs Frontend Software Engineer application'}).kind,'review'));
test('flexible matching still rejects different seniority',()=>assert.equal(decision({title:'Senior Data Analyst'},{subject:'Acorn Labs Junior Data Analyst application'}).kind,'review'));
test('company fragments do not match arbitrary brands',()=>assert.equal(decision({company:'Acorn Labs'},{subject:'Acorn Financial Data Analyst application'}).kind,'ignore'));
test('role words scattered across unrelated sentences do not match',()=>assert.equal(decision({title:'Customer Support Engineer'},{subject:'Acorn Labs application',text:'Customer service matters. Contact support. Engineer your future. We will not be moving forward.'}).kind,'review'));
test('two flexible role matches require review',()=>assert.equal(matcher.decide([{...app,title:'Software Engineer New Grad'},{...app,key:'b',title:'New Grad Software Engineer'}],{...mail,subject:'Acorn Labs New Grad Software Engineer application'},{}).kind,'review'));
