# Application Tracker

A private Google Apps Script app that checks Gmail and keeps the Progress dropdown in a job-search spreadsheet up to date. It runs on Google's servers every hour after setup, even with your browser closed.

## Install your own copy
1. Create a project at https://script.google.com/ and name it Application Tracker.
2. Replace Code.gs with google-app/Code.gs. Add a script named Matcher and paste google-app/Matcher.js. Add an HTML file named Dashboard and paste google-app/Dashboard.html.
3. In Project Settings, turn on “Show appsscript.json manifest file in editor.” Replace it with google-app/appsscript.json. This enables the Gmail service and requests read-only Gmail, Sheets editing, trigger management, and account identity access.
4. Save. Deploy → New deployment → Web app. Execute as yourself; access **Only myself**. Review Google's permission request before authorizing.
5. Open your deployment URL. In Setup, paste the spreadsheet URL with the intended tab's gid and select the earliest application date. Expected columns A–E: Job Title, Company, Date Applied, Progress, Job Link.
6. Run a scan in review mode. Inspect matches and confirm any historical proposals you want applied.
7. Enable the hourly schedule. Enable automatic changes when ready. Only clear, exact matches from emails received after enabling automatic changes are eligible. Historical messages remain review items.

Each person uses their own Google project, authorization, spreadsheet, and private history workbook. Do not share your personal deployment as a public service.

## Behavior and limits
- Searches all mail, including archived mail, labels, Spam, and Trash. Permanently deleted mail cannot be recovered.
- Requires company and full role text plus a compatible application date. Ambiguous roles, assessments, offers, conflicting wording, and Spam require review. Job Secured is always manual.
- Uses deterministic rules, not an AI model. Aliases, unusual wording, and quoted email formats can require manual review; review the source email before approving.
- Protects detected manual progress edits, verifies writes, keeps source links and a private audit log, and supports undo when no later change has occurred.
- Recent mail and older history are processed separately in resumable batches. A large mailbox may take many scheduled runs to finish its initial backfill.
- Gmail access is read-only. No mail is sent, moved, or deleted. Email subjects, sender addresses, message IDs, match reasons, and application details are stored in your private history spreadsheet; full email bodies are not stored there.
- Apps Script quotas apply. Errors appear in Setup and Google execution logs. The dashboard shows the latest 250 events; the history spreadsheet contains the full log.
- Sheets cannot guarantee an atomic compare-and-write against simultaneous human editing. Pause automation during bulk sheet edits. Keep stable job title/company/date/link fields so row identities remain consistent.
- To stop: turn off the schedule in Setup. To revoke access, remove the app through your Google account's third-party access settings. Retain or delete the private history workbook as you prefer.

## Build and tests
The distributable includes a prebuilt Dashboard.html; installation does not need Node.
For development: npm ci, then node scripts/build-google.mjs. Run node --test tests/tracker.test.mjs.
The static preview contains fictional sample data and is not connected to Gmail. The live Google app uses google.script.run to access the owner-scoped backend.

## Portfolio description
Built a personal job-application tracker using React, Google Apps Script, Gmail API, and Google Sheets. Implemented scheduled email processing, conservative application matching, manual review, edit protection, resumable backfill, audit history, and verified updates.

Developer references: [Advanced Gmail service](https://developers.google.com/apps-script/advanced/gmail) and [Utilities byte decoding](https://developers.google.com/apps-script/reference/utilities/utilities). The decoder supports both the advanced service byte-array response observed during live testing and base64url strings.
