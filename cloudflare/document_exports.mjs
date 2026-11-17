import {documentData} from "./document_data.mjs";
import {documentHtml} from "./document_layout.mjs";

const pdf = "application/pdf";
const png = "image/png";
export const privateDocumentHeaders = {"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff",
  "Referrer-Policy":"no-referrer"};

export async function exportDocument(env,{kind,id,paymentId,format,lang}) {
  const doc = await documentData(env,kind,id,paymentId,format === "png" ? "png" : "pdf",lang);
  if (!doc) return new Response(null,{status:404,headers:privateDocumentHeaders});
  const ref = paymentId === null ? id : id+"-"+paymentId;
  return renderExport(env,{html:documentHtml(doc),format,lang,filename:`little-paws-${kind}-${ref}-${lang}.${format}`});
}

export async function renderExport(env,{html,format,lang,filename}) {
  if (format === "html") {
    return new Response(html,{headers:{...privateDocumentHeaders,"Content-Type":"text/html; charset=utf-8",
      "Content-Language":lang,"Content-Security-Policy":"default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; font-src data:; frame-ancestors 'none'; base-uri 'none'"}});
  }
  if (!env.BROWSER) return new Response(null,{status:503,headers:privateDocumentHeaders});
  const output = format === "pdf"
    ? await env.BROWSER.quickAction("pdf",{html,
      pdfOptions:{format:"a4",printBackground:true,preferCSSPageSize:true,displayHeaderFooter:false}})
    : await env.BROWSER.quickAction("screenshot",{html,viewport:{width:780,height:1000,deviceScaleFactor:1.5},
      screenshotOptions:{type:"png",fullPage:true},gotoOptions:{waitUntil:"networkidle0"}});
  const type = format === "pdf" ? pdf : png;
  if (!output.ok || output.headers.get("Content-Type")?.split(";",1)[0]?.toLowerCase() !== type) {
    await output.body?.cancel();
    return new Response(null,{status:503,headers:privateDocumentHeaders});
  }
  return new Response(output.body,{headers:{...privateDocumentHeaders,"Content-Type":type,"Content-Language":lang,
    "Content-Disposition":`attachment; filename="${filename}"`}});
}
