import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

const supabaseUrl = process.env.SUPABASE_URL || "YOUR_SUPABASE_URL";
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || "YOUR_SUPABASE_ANON_KEY";

const configSource = `window.APP_CONFIG = {
  supabaseUrl: ${JSON.stringify(supabaseUrl)},
  supabaseAnonKey: ${JSON.stringify(supabaseAnonKey)},
  allowedEmailDomain: "@jeju-s.jje.hs.kr",
};
`;

fs.writeFileSync(path.join(rootDir, "config.js"), configSource, "utf8");
console.log("Generated config.js");
