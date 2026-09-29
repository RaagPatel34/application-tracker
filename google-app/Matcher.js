/* Pure matching rules shared by the Google app and automated tests. */
var TrackerMatcher = (function () {
  function normalize(value) { return String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' '); }
  function contains(text, phrase) { return phrase.length >= 3 && (' ' + text + ' ').indexOf(' ' + phrase + ' ') >= 0; }
  function classify(text) {
    var t = normalize(text);
    var rejection = /\b(not be moving forward|will not be moving forward|won t be moving forward|not moving forward with your|decided not to proceed|not selected|not been selected|unable to offer you|pursue other candidates|proceed with other candidates|move forward with other candidates|moving forward with other candidates|position has been filled|application was unsuccessful)\b/.test(t);
    var invite = /\b(invite you to (an |a |the )?interview|inviting you to (an |a |the )?interview|schedule (an |a |your |the )?interview|interview (is |has been )?scheduled|interview invitation)\b/.test(t);
    if (rejection && invite) return { status: null, reason: 'Conflicting interview and rejection wording. Review the email.' };
    if (rejection) return { status: 'Rejected', reason: 'Explicit rejection wording.' };
    if (invite) return { status: 'Interview Stage', reason: 'Explicit interview invitation.' };
    if (/\b(assessment|questionnaire|offer|next steps|unfortunately|regret|not proceed|interview)\b/.test(t)) return {status: null, reason: 'This message needs interpretation; no status was inferred.'};
    return null;
  }
  function decide(apps, message, state) {
    if ((message.labels || []).some(function (l) { return l === 'SENT' || l === 'DRAFT'; })) return {kind:'ignore', reason:'Outgoing mail or draft.'};
    var body = String(message.text || '').split(/\n(?:On .{1,180}wrote:|From:|_{5,}|-{3,}\s*Original Message)/i)[0];
    var text = normalize(message.subject + ' ' + body);
    if(!/\b(application|applicant|candidate|candidates|interview|hiring|recruiter|recruitment|assessment|employment|position|role|job offer)\b/.test(text))return {kind:'ignore',reason:'No recruiting context.'};
    var signal = classify(message.subject + ' ' + body);
    if (/\b(jobs (tailored|recommended)|job alert|recommended jobs|unsubscribe from job)\b/.test(text)) return {kind:'ignore',reason:'Job newsletter.'};
    if(signal&&/\b(if you (are|were)|if your application|should you|may not|might not|has not been filled|has not been scheduled|do not schedule)\b/.test(text))signal={status:null,reason:'Conditional or negated wording needs review.'};
    if (!signal) return { kind: 'ignore', reason: 'No status signal.' };
    var companies = apps.filter(function(a) { return contains(text, normalize(a.company)); });
    if (!companies.length) return {kind:'ignore', reason:'No tracked company in message.'};
    var candidates = companies.filter(function(a) { return contains(text, normalize(a.title)) && message.date >= a.appliedAt; });
    if (candidates.length !== 1) return {kind:'review', status:signal.status, candidates:companies.map(function(a){return a.key;}), reason:candidates.length ? 'More than one matching application.' : 'Company found, but the exact role or application date did not match.'};
    var a = candidates[0], previous = state[a.key] || {};
    if (message.date < (previous.latestEmail || 0)) return {kind:'ignore', reason:'Older than an already processed status message.'};
    if (previous.manual) return {kind:'review', key:a.key, status:signal.status, reason:'This application is protected by a manual change.'};
    if (!signal.status) return {kind:'review', key:a.key, status:null, reason:signal.reason};
    if (a.status === signal.status) return {kind:'same', key:a.key, status:signal.status, reason:'Sheet already has this status.'};
    if (a.status !== 'In Consideration') return {kind:'review', key:a.key, status:signal.status, reason:'Existing progress is protected. Review before replacing it.'};
    if ((message.labels || []).indexOf('SPAM') >= 0) return {kind:'review', key:a.key, status:signal.status, reason:'Message is in Spam; review its source first.'};
    return {kind:'update', key:a.key, status:signal.status, reason:signal.reason + ' Exact company and role matched.'};
  }
  return { normalize: normalize, classify: classify, decide: decide };
})();
if (typeof module !== 'undefined') module.exports = TrackerMatcher;
