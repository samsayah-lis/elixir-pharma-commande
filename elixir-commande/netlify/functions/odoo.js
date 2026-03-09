import https from "https";

const ODOO_URL  = process.env.ODOO_URL    || "https://odoo.elixir-pharma.fr";
const ODOO_DB   = process.env.ODOO_DB     || "healthsoft-sas-lispharma-main-13622653";
const ODOO_USER = process.env.ODOO_USER   || "pharmacien@elixirpharma.fr";
const ODOO_PASS = process.env.ODOO_APIKEY || process.env.ODOO_PASS || "";
export const ODOO_COMPANY = parseInt(process.env.ODOO_COMPANY || "2");

function esc(s) {
  return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}

// Encode any JS value to XML-RPC <value>
function enc(v) {
  if (v === null || v === undefined) return "<value><boolean>0</boolean></value>";
  if (typeof v === "boolean")        return "<value><boolean>" + (v?1:0) + "</boolean></value>";
  if (typeof v === "number")         return "<value><int>" + Math.round(v) + "</int></value>";
  if (typeof v === "string")         return "<value><string>" + esc(v) + "</string></value>";
  if (Array.isArray(v))              return "<value><array><data>" + v.map(enc).join("") + "</data></array></value>";
  const members = Object.entries(v).map(function([k,val]) {
    return "<member><name>" + esc(k) + "</name>" + enc(val) + "</member>";
  }).join("");
  return "<value><struct>" + members + "</struct></value>";
}

function buildCall(method, args) {
  const params = args.map(function(a) { return "<param>" + enc(a) + "</param>"; }).join("");
  return '<?xml version="1.0"?><methodCall><methodName>' + method + '</methodName><params>' + params + '</params></methodCall>';
}

function post(path, body) {
  return new Promise(function(resolve, reject) {
    const u = new URL(ODOO_URL);
    const buf = Buffer.from(body);
    const req = https.request({
      hostname: u.hostname, path: path, method: "POST",
      headers: { "Content-Type": "text/xml", "Content-Length": buf.length },
    }, function(res) {
      let d = ""; res.on("data", function(c){d+=c;}); res.on("end", function(){resolve(d);});
    });
    req.on("error", reject);
    req.write(buf); req.end();
  });
}

function parse(xml) {
  if (xml.includes("<fault>")) {
    const s = xml.match(/faultString[\s\S]*?<string>([\s\S]*?)<\/string>/)?.[1]
           || xml.match(/<string>([\s\S]{5,300})<\/string>/)?.[1] || "Odoo fault";
    throw new Error(String(s).substring(0, 400));
  }
  // Try scalar int
  if (!xml.includes("<struct>")) {
    const intM = xml.match(/<(?:int|i4)>(\d+)<\/(?:int|i4)>/);
    if (intM) return parseInt(intM[1]);
  }
  // Parse structs
  const results = [];
  let sPos = 0;
  while (true) {
    const sStart = xml.indexOf("<struct>", sPos);
    if (sStart === -1) break;
    const sEnd = xml.indexOf("</struct>", sStart);
    if (sEnd === -1) break;
    const block = xml.slice(sStart + 8, sEnd);
    sPos = sEnd + 9;
    const obj = {};
    let mPos = 0;
    while (true) {
      const mStart = block.indexOf("<member>", mPos);
      if (mStart === -1) break;
      const mEnd = block.indexOf("</member>", mStart);
      if (mEnd === -1) break;
      const member = block.slice(mStart + 8, mEnd);
      mPos = mEnd + 9;
      // match <n>key</n> or <n>key</n>
      const kMatch = member.match(/<n(?:ame)?>([^<]+)<\/n(?:ame)?>/);
      const vMatch = member.match(/<value>([\s\S]*?)<\/value>/);
      if (kMatch && vMatch) {
        const raw = vMatch[1];
        // Many2one fields return [id, name] as array — take the first int
        const firstInt = raw.match(/<(?:int|i4)>(\d+)<\/(?:int|i4)>/);
        if (raw.includes("<array>") && firstInt) {
          obj[kMatch[1].trim()] = parseInt(firstInt[1]);
        } else {
          obj[kMatch[1].trim()] = raw.replace(/<[^>]+>/g, "").trim();
        }
      }
    }
    if (Object.keys(obj).length > 0) results.push(obj);
  }
  return results;
}

export async function authenticate() {
  const body = buildCall("authenticate", [ODOO_DB, ODOO_USER, ODOO_PASS, {}]);
  console.log("[odoo-auth] XML:", body.substring(0, 300));
  const xml = await post("/xmlrpc/2/common", body);
  console.log("[odoo-auth] Response:", xml.substring(0, 200));
  const uid = parse(xml);
  if (!uid || uid === 0) throw new Error("Odoo auth échouée — variables ODOO_* manquantes dans Netlify");
  return uid;
}

export async function odooCall(uid, model, method, domain, kwargs) {
  const kw = kwargs || {};
  const body = buildCall("execute_kw", [ODOO_DB, uid, ODOO_PASS, model, method, [domain], kw]);
  console.log("[odoo-call]", model, method, "XML:", body.substring(0, 400));
  const xml = await post("/xmlrpc/2/object", body);
  console.log("[odoo-call] Response:", xml.substring(0, 300));
  return parse(xml);
}
