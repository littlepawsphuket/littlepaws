import {careTemplates,validCareTemplates,mergeCareTemplates} from "./care_templates.mjs";
import {configuredRates,defaultRates} from "./booking_writes.mjs";
import {validDay} from "./bookings.mjs";
import {customActivities,standardActivities} from "./care_staff.mjs";

export const themes = {
  classic:"Little Paws",christmas:"คริสต์มาส",valentine:"วาเลนไทน์",halloween:"ฮาโลวีน",
  songkran:"สงกรานต์",buddhist:"วันสำคัญทางพระพุทธศาสนา",japan:"ญี่ปุ่น",
};

const settingKeys = ["rates","capacity","care_link_hours","care_activities","care_templates","theme"];
const authorizedAdmin = `EXISTS (SELECT 1 FROM app_users u JOIN staff_access_identities a ON a.user_id=u.id
  WHERE u.id=? AND a.email=? AND u.active=1 AND u.is_admin=1)`;

function decode(value, fallback) {
  try { return JSON.parse(value) ?? fallback; } catch { return fallback; }
}

export function themeName(value) {
  return typeof value === "string" && Object.hasOwn(themes,value) ? value : "classic";
}

export async function selectedTheme(db) {
  const row = await db.prepare("SELECT value FROM system_settings WHERE key='theme'").bind().first();
  return themeName(decode(row?.value,"classic"));
}

export async function systemSettings(db) {
  const [settings,holidays] = await db.batch([
    db.prepare("SELECT key,value FROM system_settings WHERE key IN (SELECT value FROM json_each(?))").bind(JSON.stringify(settingKeys)),
    db.prepare("SELECT id,name,starts_on,ends_on FROM shop_holidays ORDER BY starts_on,id").bind(),
  ]);
  const stored = Object.fromEntries(settings.results.map(({key,value}) => [key,value]));
  const revisions = Object.fromEntries(settingKeys.map((key) => [key,stored[key] ?? null]));
  return {
    rates:configuredRates(stored.rates), capacity:decode(stored.capacity,0),
    careLinkHours:decode(stored.care_link_hours,48), theme:themeName(decode(stored.theme,"classic")),
    activities:customActivities(stored.care_activities), standardActivities:Object.values(standardActivities),
    templates:careTemplates(stored.care_templates,{...standardActivities,...Object.fromEntries(customActivities(stored.care_activities).map(label=>["activity:"+label,label]))}),
    templates_en:careTemplates(stored.care_templates,{...standardActivities,...Object.fromEntries(customActivities(stored.care_activities).map(label=>["activity:"+label,label]))},"en"),
    holidays:holidays.results, revisions,
  };
}

function validRateCents(value, service) {
  return (service === "monthly" && value === null) ||
    (Number.isSafeInteger(value) && value >= 0 && value <= 99_999_999);
}

function normalizedRates(rates) {
  if (!rates || typeof rates !== "object") return null;
  const values = {};
  for (const [service,sizes] of Object.entries(defaultRates)) {
    const row = {};
    for (const size of Object.keys(sizes)) {
      const cents = rates[service]?.[size];
      if (!validRateCents(cents,service)) return null;
      row[size] = cents === null ? null : cents/100;
    }
    values[service] = row;
  }
  return values;
}

export async function saveSystemSetting(db,form,actor) {
  const {section,revisions} = form;
  const expected = revisions && typeof revisions === "object" ? revisions : {};
  let changes;
  if (section === "rates") {
    const rates = normalizedRates(form.ratesCents);
    if (rates) changes = {rates};
  } else if (section === "capacity") {
    const {capacity,careLinkHours} = form;
    if (Number.isSafeInteger(capacity) && capacity >= 0 && capacity <= 10000 &&
        Number.isSafeInteger(careLinkHours) && careLinkHours >= 0) changes = {capacity,care_link_hours:careLinkHours};
  } else if (section === "theme" && typeof form.theme === "string" && Object.hasOwn(themes,form.theme)) {
    changes = {theme:form.theme};
  } else if (section === "care" && ["add","remove"].includes(form.action)) {
    const name = typeof form.name === "string" ? form.name.trim() : "";
    const activities = customActivities(expected.care_activities);
    if (!name || [...name].length > 60) return "invalid";
    if (form.action === "remove") {
      if (!activities.includes(name)) return "invalid";
      changes = {care_activities:activities.filter((label) => label !== name)};
    } else {
      const reserved = [...activities,...Object.values(standardActivities)];
      if (activities.length >= 100 || reserved.some((label) => label.toLowerCase() === name.toLowerCase())) return "invalid";
      changes = {care_activities:[...activities,name]};
    }
  }
  if(section === "templates") {
    // Use the current activity revision as well: never overwrite a concurrent activity edit.
    const options={...standardActivities,...Object.fromEntries(customActivities(expected.care_activities).map(label=>["activity:"+label,label]))};
    if(validCareTemplates(form.templates,options)) {
      const merged=mergeCareTemplates(expected.care_templates,form.templates);
      if(new TextEncoder().encode(JSON.stringify(merged)).length<=96000)
        changes={care_templates:merged,care_activities:customActivities(expected.care_activities)};
    }
  }
  if (!changes) return "invalid";
  const rows = Object.entries(changes).map(([key,value]) => ({key,value:JSON.stringify(value),previous:expected[key]}));
  if (rows.some(({previous}) => previous !== null && typeof previous !== "string")) return "invalid";

  // Check all previous values before updating either member of a settings group.
  const {meta} = await db.prepare(`INSERT INTO system_settings(key,value)
  WITH pending AS (
    SELECT value->>'key' AS key,value->>'value' AS value,value->>'previous' AS previous FROM json_each(?)
  )
  SELECT p.key,p.value FROM pending p
  WHERE ${authorizedAdmin} AND NOT EXISTS (
    SELECT 1 FROM pending e LEFT JOIN system_settings s ON s.key=e.key WHERE s.value IS NOT e.previous
  )
  ON CONFLICT(key) DO UPDATE SET value=excluded.value`).bind(JSON.stringify(rows),actor.id,actor.email).run();
  return meta.changes === rows.length ? "saved" : "conflict";
}

function holidayValues(form) {
  const name = typeof form?.name === "string" ? form.name.trim() : "";
  if (!name || [...name].length > 100 || !validDay(form?.starts_on) || !validDay(form?.ends_on) ||
      form.ends_on < form.starts_on) return null;
  return [name,form.starts_on,form.ends_on];
}

export async function writeHoliday(db,id,form,actor,method) {
  const identity = [actor.id,actor.email];
  const fields = method === "DELETE" ? [] : holidayValues(form);
  if (!fields) return "invalid";
  if (id === null) {
    const equal = "name=? AND starts_on=? AND ends_on=?";
    const [,lookup] = await db.batch([
      db.prepare(`INSERT INTO shop_holidays(name,starts_on,ends_on) SELECT ?,?,?
        WHERE ${authorizedAdmin} AND NOT EXISTS (SELECT 1 FROM shop_holidays WHERE ${equal})`).bind(...fields,...identity,...fields),
      db.prepare(`SELECT id FROM shop_holidays WHERE ${equal} AND ${authorizedAdmin} LIMIT 1`).bind(...fields,...identity),
    ]);
    return lookup.results.length ? "saved" : "conflict";
  }
  const previous = holidayValues(form.previous);
  if (!previous) return "invalid";
  const where = `id=? AND name=? AND starts_on=? AND ends_on=? AND ${authorizedAdmin}`;
  const query = method === "DELETE" ? `DELETE FROM shop_holidays WHERE ${where}`
    : `UPDATE shop_holidays SET name=?,starts_on=?,ends_on=? WHERE ${where}`;
  const {meta} = await db.prepare(query).bind(...fields,id,...previous,...identity).run();
  return meta.changes === 1 ? "saved" : "conflict";
}
