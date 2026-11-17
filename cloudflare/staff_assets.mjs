import {uiAssets} from "./ui_assets.mjs";

export function staffAsset(request,name) {
  if (!Object.hasOwn(uiAssets,name)) return new Response(null,{status:404});
  if (!["GET","HEAD"].includes(request.method)) return new Response(null,{status:405,headers:{Allow:"GET, HEAD"}});
  const [version,base64] = uiAssets[name];
  const headers = {
    "Content-Type":name.endsWith(".css") ? "text/css; charset=utf-8" : name.endsWith(".webp") ? "image/webp" : "image/png",
    "Cache-Control":"private, max-age=3600","X-Content-Type-Options":"nosniff",ETag:'"'+version+'"',
  };
  if (request.headers.get("If-None-Match") === headers.ETag) return new Response(null,{status:304,headers});
  const body = request.method === "HEAD" ? null : Uint8Array.from(atob(base64),(value) => value.charCodeAt(0));
  return new Response(body,{headers});
}
