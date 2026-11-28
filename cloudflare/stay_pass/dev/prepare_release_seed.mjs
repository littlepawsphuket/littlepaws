// Offline only. Rehearses configuration on a supplied private restored SQLite copy.
// Never opens a remote connection or changes existing customer, booking or cash rows.
import {DatabaseSync} from 'node:sqlite';
import {writeFile} from 'node:fs/promises';
import {savePolicyDraft,savePlan,savePrice} from '../repository.mjs';
import {approvePolicy} from '../policy_approval.mjs';
import {initialPolicy} from '../policy_content.mjs';
import {initialPlan} from '../pricing.mjs';
import {defaultTemplate,templatePreview,saveTemplate} from '../template_settings.mjs';
const [database,output,email]=process.argv.slice(2);
if(!database||!output||!email||!database.endsWith('.sqlite3')||!output.endsWith('.sql'))throw Error('Use a private restored SQLite copy, SQL output path and approved administrator email.');
const sqlite=new DatabaseSync(database);sqlite.exec('PRAGMA foreign_keys=ON');
if(sqlite.prepare('SELECT MAX(version) n FROM stay_pass_schema_versions').get().n!==23)throw Error('Apply all 23 additive migrations on the rehearsal copy first.');
const actor=sqlite.prepare('SELECT u.id,a.email FROM app_users u JOIN staff_access_identities a ON a.user_id=u.id WHERE a.email=? AND u.active=1 AND u.is_admin=1').get(email);if(!actor)throw Error('Confirmed active administrator identity required.');
if(sqlite.prepare('SELECT count(*) n FROM stay_passes').get().n!==0||sqlite.prepare('SELECT count(*) n FROM stay_pass_plans').get().n!==0)throw Error('Initial seed requires an empty Stay Pass installation. Never reset existing memberships.');
const statements=[],literal=value=>sqlite.prepare('SELECT quote(?) value').get(value).value;
const db={prepare(sql){let args=[];return {bind(...values){args=values;return this;},async first(){return sqlite.prepare(sql).get(...args)||null;},async all(){if(/^\s*(SELECT|WITH|PRAGMA)/i.test(sql))return {results:sqlite.prepare(sql).all(...args)};if(!/^\s*(INSERT INTO|UPDATE) stay_pass_/i.test(sql))throw Error('Seed write outside Stay Pass tables');const result=sqlite.prepare(sql).run(...args);let i=0;const bound=sql.replace(/\?/g,()=>literal(args[i++]));if(i!==args.length)throw Error('Placeholder mismatch');statements.push(bound+';');return {results:[],meta:{changes:result.changes}};}};},async batch(items){sqlite.exec('BEGIN');const start=statements.length;try{const result=[];for(const item of items)result.push(await item.all());sqlite.exec('COMMIT');return result;}catch(error){sqlite.exec('ROLLBACK');statements.length=start;throw error;}}};
const key=()=>crypto.randomUUID().replaceAll('-',''),now=new Date();
const reason='Owner-authorized V1.9 release; confirmed Policy 1.5 with subsequent explicit shop decisions; no existing booking, service rate or payment repriced.';
const policy=await savePolicyDraft(db,{version:initialPolicy.version,content_th:initialPolicy.th,content_en:initialPolicy.en,reason,key:key()},actor,now);
const row=sqlite.prepare('SELECT content_hash FROM stay_pass_policy_versions WHERE id=?').get(policy.id);
if((await approvePolicy(db,{policyId:policy.id,contentHash:row.content_hash,key:key(),reason,confirmed:true},actor,now)).status!=='saved')throw Error('Policy approval did not commit');
const plan=await savePlan(db,{planId:null,code:'LP-SP-15',expectedRevision:0,config:initialPlan(),key:key(),reason},actor,now);if(plan.status!=='saved')throw Error('Plan did not commit');
if((await savePrice(db,{planId:plan.planId,planVersionId:plan.id,expectedRevision:1,effectiveAt:null,key:key(),reason},actor,now)).status!=='saved')throw Error('Price did not commit');
const preview=await templatePreview(db,{config:defaultTemplate()},actor);
if((await saveTemplate(db,{config:preview.config,expectedVersion:0,previewHash:preview.preview_hash,key:key(),reason:'Owner approved portrait Ivory Wallet design and original Thai/English fonts',confirmed:true},actor,now)).status!=='saved')throw Error('Template did not commit');
if(sqlite.prepare('PRAGMA foreign_key_check').all().length)throw Error('Foreign key verification failed');
await writeFile(output,'-- Initial Stay Pass configuration only. No membership sale, customer or financial write.\n'+statements.join('\n')+'\n',{mode:0o600});
console.log(JSON.stringify({status:'rehearsed',schema:23,configuration_statements:statements.length,plan:'LP-SP-15',credits:15,sales_limit:10,prices_baht:[5100,6375,7650],admin_id:actor.id,customer_cash_writes:0}));sqlite.close();
