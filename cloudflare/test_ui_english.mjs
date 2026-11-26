import assert from 'node:assert/strict';
import {Script} from 'node:vm';
import {outstandingPage} from './staff_ui.mjs';
import {englishFunctions,uiTranslations} from './ui_english_generated.mjs';
import {uiValues} from './ui_locale.mjs';
import {intakeGroups} from './stay_terms.mjs';

export async function testUiEnglish(){
  const displayName='รายรับ <script>ชื่อผู้ใช้</script>';
  for(const language of ['th','en']){
    const response=outstandingPage(true,true,'christmas',displayName,language);
    const html=await response.text();
    assert.ok(html.includes('<html lang="'+language+'"'));
    assert.ok(html.includes('รายรับ &lt;script&gt;ชื่อผู้ใช้&lt;/script&gt;')); // User data is never translated or interpreted.
    const script=/<script[^>]*>([\s\S]*?)<\/script>/.exec(html)[1];new Script(script);
    const markup=html.replace(/<style[\s\S]*?<\/style>/g,'').replace(/<script[\s\S]*?<\/script>/g,'');
    assert.ok(markup.includes(language==='en' ? '>Bookings<' : '>การจอง<'));
    assert.ok(markup.includes(language==='en' ? '>Manage users<' : '>จัดการผู้ใช้งาน<'));
    assert.ok(markup.includes('data-ui-language="en"'));
  }
  assert.match(englishFunctions.main,/Edit stay/);
  assert.match(englishFunctions.accountScreen,/Current password/);
  assert.match(englishFunctions.backupScreen,/Download all data and attachments/);
  assert.match(englishFunctions.reportScreen,/lang === "en" \? "en-GB" : "th-TH"/); // Document language remains independently selectable.
  assert.ok(englishFunctions.dashboardScreen.includes('"ค่าฝากเลี้ยง":"#24796b"')); // Data category keys must not change.
  const english=uiValues(intakeGroups,'en');
  assert.deepEqual(english.flatMap(group=>group.fields.map(field=>field[0])),intakeGroups.flatMap(group=>group.fields.map(field=>field[0])));
  assert.equal(uiTranslations['สถานะทำหมัน'],'Neutering status');
}
