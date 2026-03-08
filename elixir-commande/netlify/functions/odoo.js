// Helper XML-RPC partagé pour Odoo
const ODOO_URL  = process.env.ODOO_URL  || "https://odoo.elixir-pharma.fr";
const ODOO_DB   = process.env.ODOO_DB   || "healthsoft-sas-lispharma-main-13622653";
const ODOO_USER = process.env.ODOO_USER || "pharmacien@elixirpharma.fr";
const ODOO_PASS = process.env.ODOO_APIKEY || process.env.ODOO_PASS || "";
const ODOO_COMPANY = parseInt(process.env.ODOO_COMPANY || "2");

import https from "https";

function xmlVal(type, val) {
  if (type === "int")    return `<value><int>${val}</int></value>`;
  if (type === "string") return `<value><string>${String(val).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}</string></value>`;
  if (type === "bool")   return `<value><boolean>${val ? 1 : 0}</boolean></value>`;
  if (type === "array")  return `<value><array><data>${val}</data></array></value>`;
  if (type === "struct") return `<value><struct>${val}</struct></value>`;
  return `<value>${val}</value>`;
}
function xmlMember(name, val) { return `<member><n>${name}</n>${val}</member>`; }

function buildCall(method, params) {
  return `<?xml version="1.0"?><methodCall><methodName>${method}</methodName><params>${
    params.map(p => `<param>${p}</param>`).join("")
  }</params></methodCall>`;
}

function xmlPost(path, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(ODOO_URL);
    const buf = Buffer.from(body, "utf-8");
    const req = https.request({
      hostname: u.hostname, path, method: "POST",
      headers: { "Content-Type": "text/xml", "Content-Length": buf.length },
    }, res => {
      let data = ""; res.on("data", d => data += d);
      res.on("end", () => resolve(data));
    });
    req.on("error", reject);
    req.write(buf); req.end();
  });
}

function parseResponse(xml) {
  if (xml.includes("<fault>")) {
    const msg = xml.match(/<n(?:ame)?>faultString<\/n(?:ame)?>\s*<value><string>([\s\S]*?)<\/string>/)?.[1]
              || xml.match(/<string>([\s\S]{5,200}?)<\/string>/)?.[1] || "Fault";
    throw new Error(String(msg).substring(0, 300));
  }
  const results = [];
  let sIdx = 0;
  while (true) {
    const sStart = xml.indexOf("<struct>", sIdx);
    if (sStart === -1) break;
    const sEnd = xml.indexOf("</struct>", sStart);
    if (sEnd === -1) break;
    const block = xml.slice(sStart + 8, sEnd);
    sIdx = sEnd + 9;
    const obj = {};
    let mIdx = 0;
    while (true) {
      const mStart = block.indexOf("<member>", mIdx);
      if (mStart === -1) break;
      const mEnd = block.indexOf("</member>", mStart);
      if (mEnd === -1) break;
      const member = block.slice(mStart + 8, mEnd);
      mIdx = mEnd + 9;
      const keyMatch = member.match(/<n(?:ame)?>([^<]+)<\/n(?:ame)?>/);
      const valMatch = member.match(/<value>([\s\S]*?)<\/value>/);
      if (keyMatch && valMatch) obj[keyMatch[1].trim()] = valMatch[1].replace(/<[^>]+>/g, "").trim();
    }
    if (Object.keys(obj).length > 0) results.push(obj);
  }
  // Also try to parse scalar
  if (results.length === 0) {
    const i = xml.match(/<int>(\d+)<\/int>/)?.[1];
    if (i) return parseInt(i);
  }
  return results;
}

function encodeDomain(d) {
  if (typeof d === "string") return xmlVal("string", d);
  const [f, op, v] = d;
  let vXml;
  if (Array.isArray(v)) vXml = xmlVal("array", v.map(x => typeof x === "number" ? xmlVal("int", x) : xmlVal("string", String(x))).join(""));
  else if (typeof v === "number") vXml = xmlVal("int", v);
  else if (typeof v === "boolean") vXml = xmlVal("bool", v);
  else vXml = xmlVal("string", String(v));
  return xmlVal("array", [xmlVal("string", f), xmlVal("string", op), vXml].join(""));
}

async function authenticate() {
  const xml = await xmlPost("/xmlrpc/2/common", buildCall("authenticate", [
    xmlVal("string", ODOO_DB), xmlVal("string", ODOO_USER),
    xmlVal("string", ODOO_PASS), xmlVal("struct", ""),
  ]));
  const uid = parseResponse(xml);
  if (!uid || uid === 0) throw new Error("Odoo auth échouée");
  return uid;
}

async function odooCall(uid, model, method, domain, kwargs = {}) {
  const domainXml = xmlVal("array", domain.map(encodeDomain).join(""));
  const kwargsXml = xmlVal("struct", Object.entries(kwargs).map(([k, v]) => {
    let vXml;
    if (Array.isArray(v)) vXml = xmlVal("array", v.map(x => xmlVal("string", String(x))).join(""));
    else if (typeof v === "number") vXml = xmlVal("int", v);
    else vXml = xmlVal("string", String(v));
    return xmlMember(k, vXml);
  }).join(""));

  const xml = await xmlPost("/xmlrpc/2/object", buildCall("execute_kw", [
    xmlVal("string", ODOO_DB), xmlVal("int", uid), xmlVal("string", ODOO_PASS),
    xmlVal("string", model), xmlVal("string", method),
    xmlVal("array", domainXml), kwargsXml,
  ]));
  return parseResponse(xml);
}

export { authenticate, odooCall, xmlVal, xmlMember, ODOO_COMPANY };
