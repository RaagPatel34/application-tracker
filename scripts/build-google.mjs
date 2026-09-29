import {zipSync,strToU8} from 'fflate';
import {build} from 'esbuild';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import fs from 'node:fs/promises';
import path from 'node:path';
console.log('Dependencies loaded');
const root=process.cwd();
await fs.mkdir('dist/install',{recursive:true});
const result=await build({entryPoints:['app/google-entry.tsx'],bundle:true,write:false,minify:true,format:'iife',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'omit-css',setup(b){b.onLoad({filter:/\.css$/},()=>({contents:'',loader:'js'}));}}]});
console.log('JavaScript bundled');
const css=await postcss([tailwind({base:root})]).process(await fs.readFile('app/globals.css','utf8'),{from:path.join(root,'app/globals.css')});
const js=result.outputFiles[0].text.replace(/<\/script/gi,'<\\/script');
const html='<!doctype html><html lang="en"><head><base target="_top"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Application Tracker</title><style>'+css.css+'</style></head><body><div id="root"></div><script>'+js+'</script></body></html>';
await fs.writeFile('google-app/Dashboard.html',html);
await fs.writeFile('dist/index.html',html);
for(const file of ['Code.gs','Matcher.js','appsscript.json','Dashboard.html']){
 await fs.copyFile('google-app/'+file,'dist/install/'+file+'.txt');
 await fs.writeFile('dist/install/'+file+'.html','<!doctype html><meta charset="utf-8"><title>'+file+' source</title><pre>'+ (await fs.readFile('google-app/'+file,'utf8')).replace(/&/g,'&amp;').replace(/</g,'&lt;')+'</pre>');
}
console.log('Built Google dashboard and preview.');

await fs.copyFile('SETUP.md','dist/install/SETUP.md');
const archive={};
for(const file of ['Code.gs','Matcher.js','appsscript.json','Dashboard.html'])archive['google-app/'+file]=new Uint8Array(await fs.readFile('google-app/'+file));
archive['SETUP.md']=strToU8(await fs.readFile('SETUP.md','utf8'));
await fs.writeFile('dist/install/application-tracker.zip',zipSync(archive));
