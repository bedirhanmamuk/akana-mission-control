// Test yardımcıları: yerel yığın anahtarlarını okur, istemci ve örnek dosya üretir.
import { createClient } from "@supabase/supabase-js";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import crypto from "node:crypto";

const envPath = new URL("../local/.env.local", import.meta.url);
export const env = Object.fromEntries(
  readFileSync(envPath, "utf8").split("\n").filter(Boolean).map((l) => {
    const i = l.indexOf("=");
    return [l.slice(0, i), l.slice(i + 1)];
  }),
);

const opts = { auth: { persistSession: false, autoRefreshToken: false } };
export const service = createClient(env.SUPABASE_URL, env.SERVICE_ROLE_KEY, opts);
export const anon = () => createClient(env.SUPABASE_URL, env.ANON_KEY, opts);

export async function login(email, password) {
  const c = anon();
  const { data, error } = await c.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`login ${email}: ${error.message}`);
  c.userId = data.user.id;
  return c;
}

export function sql(query) {
  return execFileSync("psql", [env.DB_URL, "-v", "ON_ERROR_STOP=1", "-Atc", query], { encoding: "utf8" }).trim();
}

export const MIME = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  png: "image/png",
  zip: "application/zip",
  csv: "text/csv",
};

/** Geçerli dosya imzasına sahip, rastgele içerikli örnek dosya. */
export function sampleFile(ext, bytes = 2048) {
  const magic = {
    pdf: Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n"),
    docx: Buffer.from([0x50, 0x4b, 0x03, 0x04]),
    xlsx: Buffer.from([0x50, 0x4b, 0x03, 0x04]),
    zip: Buffer.from([0x50, 0x4b, 0x03, 0x04]),
    png: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    csv: Buffer.from("a,b,c\n1,2,3\n"),
  }[ext];
  const body = ext === "csv" ? Buffer.from(crypto.randomBytes(bytes).toString("hex")) : crypto.randomBytes(bytes);
  return Buffer.concat([magic, body]);
}

export const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");

let passed = 0;
const failures = [];
export function check(name, cond, detail = "") {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failures.push(name);
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}
export function section(t) { console.log(`\n${t}`); }
export function finish() {
  console.log(`\n${passed} başarılı, ${failures.length} başarısız`);
  if (failures.length) {
    console.log("Başarısız:", failures.map((f) => `\n  - ${f}`).join(""));
    process.exit(1);
  }
}
