/** Application Tracker — private, single-owner Google Apps Script app. */
var TRACKER = { config: 'tracker.config.v1', cursor: 'tracker.cursor.v1', health: 'tracker.health.v1', state: 'tracker.state.v1', statuses: ['In Consideration','Interview Stage','Rejected','Job Secured'] };
function props_() { return PropertiesService.getUserProperties(); }
function json_(key, fallback) { var raw = props_().getProperty(key); return raw ? JSON.parse(raw) : fallback; }
function save_(key, value) { props_().setProperty(key, JSON.stringify(value)); }
function owner_() {
  var active = Session.getActiveUser().getEmail(), effective = Session.getEffectiveUser().getEmail();
  if (!effective || (active && active !== effective)) throw new Error('Open your own private deployment of this app.');
  var config = json_(TRACKER.config, null);
  if (config && config.owner !== effective) throw new Error('This installation belongs to a different Google account.');
  return effective;
}
function locked_(fn) { var lock = LockService.getUserLock(); if (!lock.tryLock(3000)) throw new Error('A scan or update is already running. Try again shortly.'); try { return fn(); } finally { lock.releaseLock(); } }
function config_() { owner_(); var c = json_(TRACKER.config, null); if (!c) throw new Error('Connect your spreadsheet in Setup first.'); return c; }
function doGet() { if(Session.getActiveUser().getEmail()!==owner_())throw new Error('Use your own private deployment.'); return HtmlService.createHtmlOutputFromFile('Dashboard').setTitle('Application Tracker').addMetaTag('viewport','width=device-width, initial-scale=1'); }
function initialize() { owner_(); return 'Ready. Deploy as a private web app.'; }
function hash_(s) { return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,s,Utilities.Charset.UTF_8).map(function(b){return ('0'+((b+256)%256).toString(16)).slice(-2);}).join(''); }
function source_(c) { var ss = SpreadsheetApp.openById(c.spreadsheetId), sheet = ss.getSheetById(Number(c.sheetId)); if (!sheet) throw new Error('The selected spreadsheet tab no longer exists.'); return sheet; }
function applications_(c) {
  var sheet = source_(c), n = sheet.getLastRow(); if (n < 2) return [];
  var values = sheet.getRange(2,1,n-1,5).getValues(), tz = sheet.getParent().getSpreadsheetTimeZone();
  return values.map(function(r,i) {
    if (!r[0] || !r[1]) return null;
    var d = r[2] instanceof Date ? r[2] : new Date(r[2]);
    if (isNaN(d.getTime())) return null;
    var date = Utilities.formatDate(d,tz,'yyyy-MM-dd');
    return {key:hash_([r[0],r[1],date,r[4]].join('\u001f')),row:i+2,title:String(r[0]),company:String(r[1]),applied:date,appliedAt:d.getTime(),status:String(r[3]),link:String(r[4])};
  }).filter(Boolean);
}
var databaseCache_={};
function database_(c) { return databaseCache_[c.databaseId]||(databaseCache_[c.databaseId]=SpreadsheetApp.openById(c.databaseId)); }
function records_(c, tab) {
  var s = database_(c).getSheetByName(tab); var rows = s.getLastRow();
  return rows < 2 ? [] : s.getRange(2,1,rows-1,2).getValues().map(function(r,i){return {id:String(r[0]), data:JSON.parse(r[1]), row:i+2};});
}
function put_(c, tab, id, data) {
  var s = database_(c).getSheetByName(tab), found = s.getRange('A:A').createTextFinder(id).matchEntireCell(true).findNext();
  var row = found ? found.getRow() : s.getLastRow()+1;
  s.getRange(row,1,1,2).setValues([[id,JSON.stringify(data)]]);
}
function state_(c) { var out={}; records_(c,'Applications').forEach(function(r){out[r.id]=r.data;}); return out; }
function installTracker(input) {
  return locked_(function(){
    var email = owner_();
    if (json_(TRACKER.config,null)) throw new Error('Already connected. Pause the tracker before changing installations; use a separate copy for another spreadsheet.');
    var match = String(input.sheetUrl||'').match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
    if (!match) throw new Error('Paste a Google Sheets spreadsheet URL.');
    var gid = String(input.sheetUrl).match(/[?#&]gid=(\d+)/);
    if (!gid) throw new Error('Open the intended tab in Sheets and copy its URL, including gid=.');
    var start = String(input.startDate||'');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !Number.isFinite(Date.parse(start)) || Date.parse(start)>Date.now()) throw new Error('Choose a valid past start date.');
    var c={owner:email,spreadsheetId:match[1],sheetId:Number(gid[1]),startDate:start,autoApply:false,installedAt:new Date().toISOString()};
    var sheet=source_(c); c.sheetName=sheet.getName();
    var headers=sheet.getRange(1,1,1,5).getDisplayValues()[0];
    if (!/job|role|position/i.test(headers[0]) || !/company/i.test(headers[1]) || !/date/i.test(headers[2]) || !/progress|status/i.test(headers[3])) throw new Error('Expected columns A–E: Job Title, Company, Date Applied, Progress, Job Link. Your sheet was not changed.');
    Gmail.Users.getProfile('me');
    var db=SpreadsheetApp.create('Application Tracker — private history');
    db.getSheets()[0].setName('Events').appendRow(['ID','Record']);
    ['Applications','Messages'].forEach(function(name){db.insertSheet(name).appendRow(['ID','Record']);});
    c.databaseId=db.getId(); save_(TRACKER.config,c);
    applications_(c).forEach(function(a){put_(c,'Applications',a.key,{expected:a.status,manual:false,latestEmail:0});});
    save_(TRACKER.health,{message:'Connected. Run a review scan before enabling automatic changes.',lastRun:null});
    return getSnapshot();
  });
}
function getSnapshot() {
  var email=owner_(), c=json_(TRACKER.config,null);
  if (!c) return {mode:'live',connected:false,email:email,applications:[],events:[],running:false};
  var s=state_(c), apps=applications_(c).map(function(a){a.protected=!!(s[a.key]&&s[a.key].manual); return a;});
  var events=records_(c,'Events').map(function(r){return Object.assign({id:r.id},r.data);}).sort(function(a,b){return b.createdAt-a.createdAt;}).slice(0,250);
  var cursor=json_(TRACKER.cursor,null);
  return {mode:'live',connected:true,email:email,applications:apps,events:events,autoApply:c.autoApply,running:ScriptApp.getProjectTriggers().some(function(t){return t.getHandlerFunction()==='scheduledScan';}),sheetName:c.sheetName,sheetUrl:'https://docs.google.com/spreadsheets/d/'+c.spreadsheetId+'/edit#gid='+c.sheetId,databaseUrl:'https://docs.google.com/spreadsheets/d/'+c.databaseId+'/edit',health:json_(TRACKER.health,{}),backfill:cursor?{complete:!!cursor.backfillComplete,scanned:cursor.scanned||0}:null};
}
function setAutomation(input) {
  return locked_(function(){
    var c=config_(); if(typeof input.enabled!=='boolean'||typeof input.autoApply!=='boolean') throw new Error('Invalid automation settings.');
    if(input.autoApply&&!c.autoApply)c.autoSince=Date.now(); c.autoApply=input.autoApply; save_(TRACKER.config,c);
    ScriptApp.getProjectTriggers().forEach(function(t){if(['scheduledScan','trackManualEdit'].indexOf(t.getHandlerFunction())>=0)ScriptApp.deleteTrigger(t);});
    if(input.enabled){ScriptApp.newTrigger('scheduledScan').timeBased().everyHours(1).create();ScriptApp.newTrigger('trackManualEdit').forSpreadsheet(c.spreadsheetId).onEdit().create();}
    return getSnapshot();
  });
}
function trackManualEdit(e) {
  if(!e || !e.range) return;
  locked_(function(){var c=config_(), r=e.range; if(r.getSheet().getSheetId()!==Number(c.sheetId)||r.getColumn()>4||r.getLastColumn()<4) return;
    var state=state_(c); applications_(c).filter(function(a){return a.row>=r.getRow()&&a.row<=r.getLastRow();}).forEach(function(a){var p=state[a.key]||{}; p.manual=true;p.lastEvent=null;p.expected=a.status;put_(c,'Applications',a.key,p);});
  });
}
function setProtection(input) {return locked_(function(){var c=config_(), apps=applications_(c).filter(function(a){return a.key===input.key;}); if(apps.length!==1||typeof input.protected!=='boolean')throw new Error('Application is missing or duplicated.'); var p=state_(c)[input.key]||{};p.manual=input.protected;p.lastEvent=null;p.expected=apps[0].status;put_(c,'Applications',input.key,p);return getSnapshot();});}
function decode_(body) {
  if(!body||!body.data)return '';
  // Advanced Gmail service can return byte arrays; REST clients return base64url strings.
  var data=body.data;
  var bytes=Array.isArray(data)?data:Utilities.base64DecodeWebSafe(String(data)+'='.repeat((4-String(data).length%4)%4));
  return Utilities.newBlob(bytes).getDataAsString('UTF-8');
}
function body_(payload) {
  function collect(p,type){if(!p||p.filename)return [];if(p.mimeType===type)return [decode_(p.body)];return (p.parts||[]).reduce(function(out,x){return out.concat(collect(x,type));},[]);}
  var plain=collect(payload,'text/plain');if(plain.length)return plain.join('\n');
  return collect(payload,'text/html').join('\n').replace(/<blockquote[\s\S]*?<\/blockquote>/gi,'').replace(/<[^>]*>/g,' ').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&');
}
function message_(raw) {var headers=raw.payload.headers||[];function header(name){var h=headers.find(function(x){return x.name.toLowerCase()===name;});return h?h.value:'';}var text='',error=null;try{text=body_(raw.payload).slice(0,60000);}catch(err){error='Could not read this message body. Open the source email to review it.';}return {id:raw.id,subject:header('subject'),sender:header('from'),date:Number(raw.internalDate),labels:raw.labelIds||[],text:text,decodeError:error};}
function fresh_(c,key) {var apps=applications_(c).filter(function(a){return a.key===key;}); if(apps.length!==1)throw new Error('Application is missing or duplicated; review it in Sheets.');return apps[0];}
function writeEvent_(c,event,approved) {
  var app=fresh_(c,event.key), old=event.before, p=state_(c)[event.key]||{};
  if(event.emailDate<(p.latestEmail||0)){event.outcome='conflict';event.reason='A newer status message exists. Review the current email first.';put_(c,'Events',event.id,event);return;}
  if(app.status!==old) {event.outcome='conflict';event.reason='Progress changed since the proposal. No value was overwritten.';put_(c,'Events',event.id,event);return;}
  if(!approved&&(p.manual||p.expected!==old||event.emailDate<(p.latestEmail||0))){event.outcome='review';event.reason='A newer message or manual edit protects this application.';put_(c,'Events',event.id,event);return;}
  if(TRACKER.statuses.indexOf(event.after)<0||event.after==='Job Secured')throw new Error('Unsupported automatic status.');
  var cell=source_(c).getRange(app.row,4);if(cell.getFormula())throw new Error('Progress contains a formula; update it manually.');
  var validation=cell.getDataValidation();if(validation&&validation.getCriteriaType()===SpreadsheetApp.DataValidationCriteria.VALUE_IN_LIST&&validation.getCriteriaValues()[0].indexOf(event.after)<0)throw new Error('This status is not allowed by the dropdown.');
  // Persist intent before writing, so an interrupted execution can be reconciled.
  event.manualApproval=!!approved;event.outcome='pending';put_(c,'Events',event.id,event);SpreadsheetApp.flush();
  app=fresh_(c,event.key);cell=source_(c).getRange(app.row,4);if(cell.getValue()!==old)throw new Error('Progress changed during the update. Run another scan to reconcile.');
  cell.setValue(event.after);
  var note=cell.getNote()||'', marker='Tracker message '+event.id;
  if(note.indexOf(marker)<0)cell.setNote(note+(note?'\n\n':'')+marker+'\n'+event.before+' → '+event.after+'\n'+new Date(event.emailDate).toISOString()+'\n'+event.reason+'\n'+event.source);
  SpreadsheetApp.flush();
  if(fresh_(c,event.key).status!==event.after)throw new Error('Could not verify the spreadsheet update.');
  p.lastEvent=event.id;p.expected=event.after;p.latestEmail=Math.max(p.latestEmail||0,event.emailDate);if(approved)p.manual=true;
  put_(c,'Applications',event.key,p);event.outcome='applied';event.appliedAt=Date.now();put_(c,'Events',event.id,event);
}
function reconcile_(c) {
  records_(c,'Events').filter(function(r){return ['pending','undo_pending'].indexOf(r.data.outcome)>=0;}).forEach(function(r){
    var e=r.data,a=fresh_(c,e.key),undo=e.outcome==='undo_pending',target=undo?e.before:e.after;
    if(a.status===target){e.outcome=undo?'undone':'applied';var p=state_(c)[e.key]||{};p.expected=target;p.lastEvent=e.id;p.latestEmail=Math.max(p.latestEmail||0,e.emailDate);if(undo||e.manualApproval)p.manual=true;put_(c,'Applications',e.key,p);}
    else {e.outcome='review';e.reason='An earlier write was interrupted. Check the current sheet value.';}
    put_(c,'Events',r.id,e);
  });
}
function scanNow() { return locked_(function(){ scan_(); return getSnapshot(); }); }
function scheduledScan() { locked_(function(){scan_();}); }
function gmailRetry_(operation) {
  for(var attempt=0;;attempt++) {
    try{return operation();}catch(error){
      if(attempt>=4 || !/quota exceeded|rate limit|too many requests|userRateLimitExceeded/i.test(String(error)))throw error;
      Utilities.sleep(Math.pow(2,attempt)*1000);
    }
  }
}
function scan_() {
  var c=config_(), started=Date.now();
  try {
    reconcile_(c);
    var apps=applications_(c), state=state_(c);
    apps.forEach(function(a){var p=state[a.key],changed=false;if(!p){p={expected:a.status,manual:false,latestEmail:0};changed=true;}else if(p.expected!==a.status){p.expected=a.status;p.manual=true;p.lastEvent=null;changed=true;}state[a.key]=p;if(changed)put_(c,'Applications',a.key,p);});
    var signature=hash_('matcher-v5|'+apps.map(function(a){return a.key;}).sort().join('|'));
    var cursor=json_(TRACKER.cursor,null),now=Math.floor(Date.now()/1000);
    if(!cursor||c.signature!==signature){cursor={after:Math.floor(Date.parse(c.startDate+'T00:00:00Z')/1000)-86400,before:now,page:null,scanned:0,backfillComplete:false};c.signature=signature;save_(TRACKER.config,c);save_(TRACKER.cursor,cursor);}
    var liveKey='tracker.live.v1',live=json_(liveKey,null);
    if(!live||live.finished)live={after:Math.max((live?live.before:cursor.before)-172800,0),before:now,page:null,scanned:0};
    var seen={},events={};records_(c,'Messages').forEach(function(r){seen[r.id]=r.data.signature;});records_(c,'Events').forEach(function(r){events[r.id]=r.data;});
    var processed=0;
    function lane(part,key,limit,backfill){
      var count=0;
      while(!part.finished&&Date.now()-started<210000&&count<limit){
        var args={q:'in:anywhere after:'+part.after+' before:'+part.before,includeSpamTrash:true,maxResults:20};if(part.page)args.pageToken=part.page;
        var page;try{page=gmailRetry_(function(){return Gmail.Users.Messages.list('me',args);});}catch(err){if(part.page){part.page=null;save_(key,part);}throw err;}
        var ids=page.messages||[],complete=true;
        for(var i=0;i<ids.length;i++){
          if(Date.now()-started>225000){complete=false;break;}
          var id=ids[i].id;
          if(seen[id]===signature)continue;
          if(events[id]&&['applied','undone','dismissed','conflict'].indexOf(events[id].outcome)>=0){put_(c,'Messages',id,{processedAt:Date.now(),signature:signature});seen[id]=signature;continue;}
          var m=message_(gmailRetry_(function(){return Gmail.Users.Messages.get('me',id,{format:'full'});})),decision=m.decodeError?{kind:'review',status:null,reason:m.decodeError}:TrackerMatcher.decide(apps,m,state);
          if(events[id]&&events[id].outcome==='review'&&(decision.kind==='ignore'||decision.kind==='same')){var resolved=events[id];resolved.outcome='resolved';resolved.reason='Message successfully rechecked. '+decision.reason;put_(c,'Events',id,resolved);}
          if(decision.kind==='review'||decision.kind==='update'){
            var a=apps.find(function(x){return x.key===decision.key;});
            var event={id:m.id,createdAt:Date.now(),emailDate:m.date,subject:m.subject,sender:m.sender,source:'https://mail.google.com/mail/u/?authuser='+encodeURIComponent(c.owner)+'#all/'+m.id,key:decision.key||null,company:a?a.company:'Needs a match',title:a?a.title:m.subject,before:a?a.status:null,after:decision.status||null,reason:decision.reason,outcome:'review',candidates:decision.candidates||[]};
            put_(c,'Events',event.id,event);events[id]=event;
            if(decision.kind==='update'&&c.autoApply&&!backfill&&m.date>=(c.autoSince||Infinity)){writeEvent_(c,event,false);apps=applications_(c);state=state_(c);}
          }
          if(decision.key){var p=state[decision.key];p.latestEmail=Math.max(p.latestEmail||0,m.date);put_(c,'Applications',decision.key,p);}
          put_(c,'Messages',m.id,{processedAt:Date.now(),signature:signature});seen[m.id]=signature;processed++;count++;part.scanned++;
        }
        if(!complete){save_(key,part);break;}
        part.page=page.nextPageToken||null;
        if(!part.page){part.finished=true;if(backfill)part.backfillComplete=true;}
        save_(key,part);
      }
    }
    lane(live,liveKey,40,false);
    // Prioritize cleaning existing review items rather than waiting for the full backfill.
    var reviewIds=Object.keys(events).filter(function(id){return events[id].outcome==='review'&&events[id].reviewFilterVersion!=='v5';});
    for(var r=0;r<Math.min(reviewIds.length,20)&&Date.now()-started<210000;r++){
      var review=events[reviewIds[r]],reviewMail=message_(gmailRetry_(function(){return Gmail.Users.Messages.get('me',review.id,{format:'full'});}));
      if(reviewMail.decodeError)continue;
      var check=TrackerMatcher.decide(apps,reviewMail,state);
      review.reviewFilterVersion='v5';
      if(check.kind==='ignore'||check.kind==='same'){
        review.outcome='resolved';review.reason='Review filter recheck: '+check.reason;
      }
      put_(c,'Events',review.id,review);
    }
    lane(cursor,TRACKER.cursor,60,true);
    save_(TRACKER.health,{lastRun:new Date().toISOString(),message:'Checked '+processed+' messages this run.',error:null});
  }catch(err){save_(TRACKER.health,{lastRun:new Date().toISOString(),message:'Scan needs attention.',error:String(err.message||err)});throw err;}
}
function reviewEvent(input) {
  return locked_(function(){var c=config_(), record=records_(c,'Events').find(function(r){return r.id===input.id;});if(!record||record.data.outcome!=='review')throw new Error('This review item has already changed. Refresh the dashboard.');var e=record.data;
    if(input.action==='dismiss'){e.outcome='dismissed';put_(c,'Events',e.id,e);}
    else if(input.action==='approve'){if(!e.key||!e.after)throw new Error('Match or status is uncertain. Update the sheet directly and dismiss this item.');writeEvent_(c,e,true);}
    else throw new Error('Unknown review action.');return getSnapshot();});
}
function undoEvent(input) {
  return locked_(function(){var c=config_(),record=records_(c,'Events').find(function(r){return r.id===input.id;});if(!record||record.data.outcome!=='applied')throw new Error('Only an applied change can be undone.');var e=record.data,a=fresh_(c,e.key);
    var current=state_(c)[e.key]||{};if(current.lastEvent!==e.id)throw new Error('A later update or manual change protects this application.');
    if(a.status!==e.after)throw new Error('Progress has changed since this update. Undo was skipped.');
    var cell=source_(c).getRange(a.row,4);if(cell.getFormula())throw new Error('Progress contains a formula.');
    e.outcome='undo_pending';put_(c,'Events',e.id,e);cell.setValue(e.before);SpreadsheetApp.flush();if(fresh_(c,e.key).status!==e.before)throw new Error('Undo could not be verified.');
    var p=state_(c)[e.key]||{};p.expected=e.before;p.manual=true;put_(c,'Applications',e.key,p);e.outcome='undone';put_(c,'Events',e.id,e);return getSnapshot();});
}

function diagnoseMail() {
  owner_();var ids=Gmail.Users.Messages.list('me',{q:'in:anywhere',includeSpamTrash:true,maxResults:3}).messages||[];
  ids.forEach(function(item){var raw=Gmail.Users.Messages.get('me',item.id,{format:'full'});function visit(p){if(p.body&&p.body.data){var data=p.body.data,report={mime:p.mimeType,type:typeof data,array:Array.isArray(data),length:String(data).length,base64:/^[A-Za-z0-9_+\\/=-]+$/.test(String(data)),object:Object.prototype.toString.call(data)};try{report.decodedLength=decode_(p.body).length;}catch(e){report.error=String(e);}console.log(JSON.stringify(report));}(p.parts||[]).forEach(visit);}visit(raw.payload);});
}
