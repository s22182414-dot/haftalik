import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import { createServer as createViteServer } from 'vite';
import cron from 'node-cron';
import { google } from 'googleapis';
import TelegramBot from 'node-telegram-bot-api';
import ExcelJS from 'exceljs';
import path from 'path';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { Readable } from 'stream';
import fs from 'fs/promises';
import crypto from 'crypto';
import puppeteer from 'puppeteer';
import { TelegramClient, Api } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';

import { exec } from 'child_process';
import util from 'util';

const execPromise = util.promisify(exec);
const app = express();
const PORT = parseInt(process.env.PORT || '3001', 10);

app.use(express.json());

// ── Real-time Log Streaming (SSE) ────────────────────────────────────────────
// Barcha ulangan brauzer clientlarini saqlash
const logClients = new Set<any>();
const logBuffer: { level: string; msg: string; ts: string }[] = [];

// Barcha consolellarni SSE orqali browserlarga ham yuborish (monkey-patch)
const _origLog   = console.log.bind(console);
const _origWarn  = console.warn.bind(console);
const _origError = console.error.bind(console);

function _sendToClients(level: 'info' | 'warn' | 'error', args: any[]) {
  const msg = args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
  const entry = { level, msg, ts: new Date().toISOString() };
  
  // Keep last 250 logs
  logBuffer.push(entry);
  if (logBuffer.length > 250) logBuffer.shift();

  if (logClients.size === 0) return;
  const data = JSON.stringify(entry);
  for (const res of logClients) {
    try { res.write(`data: ${data}\n\n`); } catch {}
  }
}

console.log   = (...args: any[]) => { _origLog(...args);   _sendToClients('info',  args); };
console.warn  = (...args: any[]) => { _origWarn(...args);  _sendToClients('warn',  args); };
console.error = (...args: any[]) => { _origError(...args); _sendToClients('error', args); };

// SSE endpoint — brauzer shu yerga ulanadi va real-time loglarni oladi
app.get('/api/logs', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.flushHeaders();
  // Ulanish tasdig'i
  const welcome = JSON.stringify({ level: 'info', msg: "🟢 Server log oqimi ulandi. Barcha amallar shu yerda ko'rinadi.", ts: new Date().toISOString() });
  res.write(`data: ${welcome}\n\n`);
  logClients.add(res);
  req.on('close', () => logClients.delete(res));
});

// Diagnostics endpoint to view logs
app.get('/api/diagnostics/logs', (req, res) => {
  res.json(logBuffer);
});
// ─────────────────────────────────────────────────────────────────────────────

// Excel varaqlari — rasmda ko'ringan haqiqiy nomlar
const CLASS_SHEETS = [
  '1b',   '1g',   // 1-sinf
  '2b',   '2g',   // 2-sinf
  '3',            // 3-sinf (bitta guruh)
  '4',            // 4-sinf (bitta guruh)
  '5b',           // 5-sinf
  '6b',   '6g',   // 6-sinf
  '7b',           // 7-sinf
  '8b',   '8g',   // 8-sinf
  '9',            // 9-sinf (bitta guruh)
  '10b',          // 10-sinf
  '1tib',         // 1-tibbiyot
  '2tib',         // 2-tibbiyot
];


// Telegram kanallar: TELEGRAM_CHANNEL_1, TELEGRAM_CHANNEL_2, ... formatida o'qiladi
// Yangi kanal qo'shish uchun .env ga TELEGRAM_CHANNEL_4="..." qo'shing
function parseChatIds(): string[] {
  const ids: string[] = [];
  let i = 1;
  while (true) {
    const val = (process.env[`TELEGRAM_CHANNEL_${i}`] || '').trim();
    if (!val) break;
    ids.push(val);
    i++;
  }
  // Fallback: eski TELEGRAM_CHAT_ID (agar TELEGRAM_CHANNEL_* topilmasa)
  if (ids.length === 0) {
    const single = (process.env.TELEGRAM_CHAT_ID || '').trim();
    if (single) ids.push(single);
  }
  return ids;
}

const constants = {
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || '',
  get telegramChatIds() { return parseChatIds(); },
  targetExcelLink: process.env.TARGET_EXCEL_LINK || '',
};

function getFileIdFromLink(link: string): string | null {
  if (!link) return null;
  const match = link.match(/\/d\/([a-zA-Z0-9-_]+)/);
  return match ? match[1] : null;
}

// --- Google OAuth2 Auth ---
const TOKENS_PATH = path.join(process.cwd(), 'tokens.json');

function getOAuthClient() {
  const appUrl = (process.env.APP_URL || '').replace(/\/$/, '');
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    `${appUrl}/api/auth/google/callback`
  );
}

// Tokenlarni o'qish: tokens.json, keyin database.json, keyin GOOGLE_REFRESH_TOKEN env var
async function loadTokens(): Promise<any | null> {
  // 1. tokens.json dan o'qib ko'ramiz
  try {
    const data = await fs.readFile(TOKENS_PATH, 'utf-8');
    const t = JSON.parse(data);
    if (t && (t.refresh_token || t.access_token)) return t;
  } catch {}

  // 2. database.json dan o'qib ko'ramiz (Render restart bo'lganda tokens.json yo'qoladi)
  try {
    const dbData = await fs.readFile(path.join(process.cwd(), 'database.json'), 'utf-8');
    const db = JSON.parse(dbData);
    if (db.googleTokens && (db.googleTokens.refresh_token || db.googleTokens.access_token)) {
      // database.json dagi tokenlarni tokens.json ga ham yozib olamiz
      await fs.writeFile(TOKENS_PATH, JSON.stringify(db.googleTokens, null, 2)).catch(() => {});
      return db.googleTokens;
    }
  } catch {}

  // 3. GOOGLE_REFRESH_TOKEN env var dan yaratamiz (Render environment variables)
  if (process.env.GOOGLE_REFRESH_TOKEN) {
    const tokens = {
      refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
      token_type: 'Bearer',
      scope: 'https://www.googleapis.com/auth/drive'
    };
    await fs.writeFile(TOKENS_PATH, JSON.stringify(tokens, null, 2)).catch(() => {});
    return tokens;
  }

  return null;
}

// Tokenlarni saqlash: tokens.json va database.json ga birga
async function saveTokens(tokens: any): Promise<void> {
  // tokens.json ga yoz
  await fs.writeFile(TOKENS_PATH, JSON.stringify(tokens, null, 2)).catch(() => {});
  // database.json ga ham yoz (Render restart bo'lganda saqlanib qolsin)
  try {
    const dbData = await fs.readFile(path.join(process.cwd(), 'database.json'), 'utf-8').catch(() => '{}');
    const db = JSON.parse(dbData);
    db.googleTokens = tokens;
    await fs.writeFile(path.join(process.cwd(), 'database.json'), JSON.stringify(db, null, 2));
  } catch {}
  // refresh_token ni loglarga chiqaramiz — Render env var ga qo'shish uchun
  if (tokens.refresh_token) {
    console.log(`[AUTH] ✅ Google ulandi! refresh_token: ${tokens.refresh_token}`);
    console.log(`[AUTH] 📋 Render Environment Variables ga qo'shing: GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}`);
  }
}

app.get('/api/debug-env', (req, res) => {
  const envKeys = Object.keys(process.env).filter(k => 
    k.includes('GOOGLE') || 
    k.includes('TELEGRAM') || 
    k.includes('BOT') || 
    k.includes('KEY') || 
    k.includes('CLIENT') || 
    k.includes('APP') || 
    k.includes('URL')
  );
  res.json({
    GEMINI_API_KEY: !!process.env.GEMINI_API_KEY,
    GOOGLE_CLIENT_ID: !!process.env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_ID_length: process.env.GOOGLE_CLIENT_ID ? process.env.GOOGLE_CLIENT_ID.length : 0,
    GOOGLE_CLIENT_SECRET: !!process.env.GOOGLE_CLIENT_SECRET,
    GOOGLE_CLIENT_SECRET_length: process.env.GOOGLE_CLIENT_SECRET ? process.env.GOOGLE_CLIENT_SECRET.length : 0,
    TELEGRAM_BOT_TOKEN: !!process.env.TELEGRAM_BOT_TOKEN,
    APP_URL: process.env.APP_URL || null,
    NODE_ENV: process.env.NODE_ENV || null,
    PORT: process.env.PORT || null,
    all_matched_env_keys: envKeys
  });
});

app.get('/api/auth/google', async (req, res) => {
  const oauth2Client = getOAuthClient();
  // Agar tokens.json mavjud bo'lsa va refresh_token bor bo'lsa — qayta login shart emas
  let hasRefreshToken = false;
  try {
    const saved = await loadTokens();
    if (saved && saved.refresh_token) hasRefreshToken = true;
  } catch {}

  const authOptions: any = {
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/drive'],
  };
  // Faqat refresh_token yo'q bo'lsa consent so'raymiz
  if (!hasRefreshToken) {
    authOptions.prompt = 'consent';
  }
  const url = oauth2Client.generateAuthUrl(authOptions);
  res.redirect(url);
});

app.get('/api/auth/google/callback', async (req, res) => {
  const { code } = req.query;
  const oauth2Client = getOAuthClient();
  try {
    const { tokens } = await oauth2Client.getToken(code as string);
    // Agar yangi tokenda refresh_token yo'q bo'lsa — eskisini saqlaymiz
    let finalTokens: any = { ...tokens };
    if (!finalTokens.refresh_token) {
      try {
        const oldTokens = await loadTokens();
        if (oldTokens && oldTokens.refresh_token) {
          finalTokens.refresh_token = oldTokens.refresh_token;
        }
      } catch {}
    }
    await saveTokens(finalTokens);
    res.send(`
      <script>
        window.opener ? window.opener.postMessage('google-auth-success', '*') : null;
        window.close();
      </script>
      <h1>Muvaffaqiyatli ulandi! Bu oynani yopishingiz mumkin.</h1>
    `);
  } catch (error) {
    res.status(500).send('Xatolik yuz berdi: ' + String(error));
  }
});

app.post('/api/auth/google/disconnect', async (req, res) => {
  try { await fs.unlink(TOKENS_PATH); } catch {}
  // database.json dan ham o'chiramiz
  try {
    const dbData = await fs.readFile(path.join(process.cwd(), 'database.json'), 'utf-8');
    const db = JSON.parse(dbData);
    delete db.googleTokens;
    await fs.writeFile(path.join(process.cwd(), 'database.json'), JSON.stringify(db, null, 2));
  } catch {}
  res.json({ success: true, message: "Google Drive ulanishi uzildi." });
});

// Refresh tokenni ko'rish uchun (Render env var ga qo'shish)
app.get('/api/auth/google/token-info', async (req, res) => {
  try {
    const tokens = await loadTokens();
    if (!tokens) return res.json({ connected: false, refresh_token: null });
    res.json({
      connected: !!(tokens.refresh_token || tokens.access_token),
      has_refresh_token: !!tokens.refresh_token,
      refresh_token: tokens.refresh_token || null,
      hint: tokens.refresh_token
        ? `Render > Environment Variables ga qo'shing: GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}`
        : 'Avval Google hisobini ulang'
    });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});// --- Database Logic ---
const DB_FILE = path.join(process.cwd(), 'database.json');

// --- Telegram Userbot State ---
let tempTelegramClient: any = null;
let tempPhoneNumber = "";
let tempPhoneCodeHash = "";
let tempApiId = 0;
let tempApiHash = "";

async function initDB() {
  try {
    await fs.access(DB_FILE);
  } catch {
    await fs.writeFile(DB_FILE, JSON.stringify({
      students: [
        { id: '101', name: 'Aliyev Vali', grade: '9-A', gpa: '4.8', status: 'Faol' },
        { id: '102', name: 'Karimova Nargiza', grade: '10-B', gpa: '5.0', status: 'Faol' },
        { id: '103', name: 'Rustamov Jasur', grade: '11-A', gpa: '3.9', status: 'Faol' },
        { id: '104', name: 'Nazarova Malika', grade: '8-V', gpa: '4.5', status: 'Faol' },
      ],
      teachers: [
        { id: '1', name: 'Olimov Aziz', subject: 'Matematika', phone: '+998 90 123 45 67', exp: '10 yil' },
        { id: '2', name: 'Raximova Dilnoza', subject: 'Ingliz tili', phone: '+998 93 987 65 43', exp: '5 yil' }
      ],
      classes: [
        { id: '1', name: '11-A', teacher: 'Olimov Aziz', students: 28, room: 'Xona 101' },
        { id: '2', name: '10-B', teacher: 'Raximova Dilnoza', students: 32, room: 'Xona 204' }
      ],
      grades: [
        { id: '1', name: 'Aliyev Vali', math: 5, physics: 4, english: 5, history: 4 },
        { id: '2', name: 'Karimova Nargiza', math: 5, physics: 5, english: 5, history: 5 }
      ]
    }, null, 2));
  }
}

async function readDB() {
  const data = await fs.readFile(DB_FILE, 'utf-8');
  return JSON.parse(data);
}

async function writeDB(data: any) {
  await fs.writeFile(DB_FILE, JSON.stringify(data, null, 2));
}

initDB();

app.get('/api/data/:collection', async (req, res) => {
  const { collection } = req.params;
  const db = await readDB();
  if (db[collection]) res.json(db[collection]);
  else res.status(404).json({ error: 'Topilmadi' });
});

// ── Telegram Userbot API Endpoints ──

app.get('/api/userbot/status', async (req, res) => {
  try {
    const db = await readDB();
    if (db.userbotSession) {
      return res.json({
        connected: true,
        phoneNumber: db.userbotSession.phoneNumber,
        apiId: db.userbotSession.apiId
      });
    }
    return res.json({ connected: false });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

app.post('/api/userbot/connect', async (req, res) => {
  const { apiId, apiHash, phoneNumber } = req.body;
  if (!apiId || !apiHash || !phoneNumber) {
    return res.status(400).json({ error: "API ID, API Hash va Telefon raqami majburiy." });
  }

  try {
    if (tempTelegramClient) {
      try { await tempTelegramClient.disconnect(); } catch {}
      tempTelegramClient = null;
    }

    tempApiId = parseInt(apiId);
    tempApiHash = apiHash.trim();
    tempPhoneNumber = phoneNumber.trim();

    const session = new StringSession("");
    tempTelegramClient = new TelegramClient(session, tempApiId, tempApiHash, {
      connectionRetries: 5,
    });

    console.log(`[USERBOT] Telegramga ulanmoqda (${tempPhoneNumber})...`);
    await tempTelegramClient.connect();

    console.log(`[USERBOT] Tasdiqlash kodi so'ralmoqda...`);
    const result = await tempTelegramClient.sendCode({
      apiId: tempApiId,
      apiHash: tempApiHash,
    }, tempPhoneNumber);

    tempPhoneCodeHash = result.phoneCodeHash;
    console.log(`[USERBOT] Tasdiqlash kodi muvaffaqiyatli so'raldi.`);
    res.json({ success: true, message: "Kod yuborildi. Iltimos, Telegramingizni tekshiring." });
  } catch (error: any) {
    console.error(`[USERBOT] Ulanishda xato:`, error.message);
    res.status(500).json({ error: error.message || String(error) });
  }
});

app.post('/api/userbot/verify', async (req, res) => {
  const { code, password } = req.body;
  if (!code) {
    return res.status(400).json({ error: "Tasdiqlash kodi kiritilishi shart." });
  }

  if (!tempTelegramClient) {
    return res.status(400).json({ error: "Ulanish sessiyasi topilmadi. Avval kod yuboring." });
  }

  try {
    console.log(`[USERBOT] Kod tekshirilmoqda: ${code}`);
    
    let user;
    try {
      user = await tempTelegramClient.invoke(
        new Api.auth.SignIn({
          phoneNumber: tempPhoneNumber,
          phoneCodeHash: tempPhoneCodeHash,
          phoneCode: code,
        })
      );
    } catch (signInErr: any) {
      if (signInErr.message.includes("SESSION_PASSWORD_NEEDED")) {
        if (!password) {
          return res.json({ success: false, passwordRequired: true, message: "Ikki bosqichli parol (2FA) talab etiladi." });
        }
        console.log(`[USERBOT] 2FA parol bilan kirishga urinish...`);
        user = await tempTelegramClient.signInWithPassword(
          {
            apiId: tempApiId,
            apiHash: tempApiHash,
          },
          {
            password: async () => password,
            onError: (err: any) => {
              console.error("[USERBOT] signInWithPassword error:", err.message || err);
              throw err;
            }
          }
        );
      } else {
        throw signInErr;
      }
    }

    const sessionStr = tempTelegramClient.session.save() as string;
    
    const db = await readDB();
    db.userbotSession = {
      apiId: tempApiId,
      apiHash: tempApiHash,
      phoneNumber: tempPhoneNumber,
      sessionStr: sessionStr
    };
    await writeDB(db);

    console.log(`[USERBOT] Muvaffaqiyatli ulandi!`);
    
    tempTelegramClient = null;
    tempPhoneNumber = "";
    tempPhoneCodeHash = "";
    tempApiId = 0;
    tempApiHash = "";

    res.json({ success: true, message: "Telegram profilingiz muvaffaqiyatli ulandi!" });
  } catch (error: any) {
    console.error(`[USERBOT] Kod tasdiqlashda xato:`, error.message);
    res.status(500).json({ error: error.message || String(error) });
  }
});

app.post('/api/userbot/disconnect', async (req, res) => {
  try {
    const db = await readDB();
    if (db.userbotSession) {
      try {
        const session = new StringSession(db.userbotSession.sessionStr);
        const client = new TelegramClient(session, db.userbotSession.apiId, db.userbotSession.apiHash, { connectionRetries: 1 });
        await client.connect();
        await client.invoke(new Api.auth.LogOut());
      } catch (e) {}

      delete db.userbotSession;
      await writeDB(db);
    }
    res.json({ success: true, message: "Ulanish uzildi." });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

app.post('/api/data/:collection', async (req, res) => {
  const { collection } = req.params;
  const db = await readDB();
  if (!db[collection]) db[collection] = [];
  const newItem = { id: Date.now().toString(), ...req.body };
  db[collection].push(newItem);
  await writeDB(db);
  res.json(newItem);
});

app.delete('/api/data/:collection/:id', async (req, res) => {
  const { collection, id } = req.params;
  const db = await readDB();
  if (!db[collection]) return res.status(404).json({ error: 'Topilmadi' });
  db[collection] = db[collection].filter((item: any) => String(item.id) !== String(id));
  await writeDB(db);
  res.json({ success: true });
});

app.post('/api/data/reset-gpa', async (req, res) => {
  const db = await readDB();
  if (db.students) {
    db.students = db.students.map((s: any) => ({ ...s, gpa: "0.0" }));
    await writeDB(db);
  }
  res.json({ success: true });
});

app.get('/api/config', async (_req, res) => {
  let googleConnected = false;
  try {
    const savedTokens = await loadTokens();
    // Token va refresh_token mavjudligini tekshiramiz
    if (savedTokens && (savedTokens.refresh_token || savedTokens.access_token)) {
      // Agar token muddati o'tgan bo'lsa, refresh qilamiz
      const oauth2Client = getOAuthClient();
      oauth2Client.setCredentials(savedTokens);
      if (savedTokens.expiry_date && Date.now() > savedTokens.expiry_date - 60000) {
        // Token muddati o'tgan yoki o'tay deb turibdi — refresh qilamiz
        if (savedTokens.refresh_token) {
          try {
            const { credentials } = await oauth2Client.refreshAccessToken();
            const updated = { ...savedTokens, ...credentials };
            await saveTokens(updated);
            googleConnected = true;
          } catch (refreshErr) {
            console.error('[AUTH] Token refresh failed:', refreshErr);
            googleConnected = false;
          }
        } else {
          googleConnected = false;
        }
      } else {
        googleConnected = true;
      }
    }
  } catch {}

  const chatIds = constants.telegramChatIds;
  res.json({
    isTelegramConfigured: !!constants.telegramBotToken && chatIds.length > 0,
    telegramChannelCount: chatIds.length,
    googleConnected,
    authMode: 'oauth2'
  });
});

// Modellar eng kuchsizidan kuchlisiga qarab tartibda (ushbu API key uchun mavjud modellar)
const AI_MODELS = [
  'gemini-2.0-flash-lite',
  'gemini-2.0-flash',
  'gemini-2.5-flash',
  'gemini-2.5-pro',
  'gemini-3.1-flash-lite',
  'gemini-3.1-pro-preview',
];


// Har bir sinf uchun AI ga beriladigan prompt (haftalik imtihon formati)
function buildPrompt(className: string): string {
  return `Sen JSON formatida faqat sof JSON qaytaradigan yordamchisan. Hech qanday markdown, kod bloki yoki izoh ishlatma.
${className} sinfi uchun HAFTALIK IMTIHON natijalarini quyidagi AYNAN shu formatda qaytargin:
[
  {
    "familiya": "YUSUPOV",
    "ism": "JASURBEK",
    "ona_1_10": 9,
    "ona_11_20": 8,
    "ona_21_30": 10,
    "mat_1_10": 10,
    "mat_11_20": 9,
    "mat_21_30": 8,
    "ing_1_10": 7,
    "ing_11_20": 9,
    "ing_21_30": 8,
    "rus_1_10": 8,
    "rus_11_20": 7,
    "rus_21_30": 9
  }
]
Qoidalar:
- Jami 15-20 ta o'quvchi qaytargin
- Haqiqiy o'zbek familiya va ismlarini KATTA HARFLAR bilan yoz
- Har bir baho 1 dan 10 gacha bo'lsin (butun son)
- Faqat JSON array qaytargin, boshqa hech narsa yozma`;
}

// -------------------------------------------------------
// Excel varaq yaratish — rasmga mos styled format
// -------------------------------------------------------
async function buildClassSheet(workbook: ExcelJS.Workbook, className: string, students: any[]) {
  const r = (n: any) => parseFloat(n) || 0;

  // Sinf nomi (1b => 1-blue, 1g => 1-green)
  const isGreen = className.endsWith('g');
  const displayName = isGreen
    ? `${className.slice(0, -1)}-green`
    : `${className.slice(0, -1)}-blue`;

  // ── FON RANGLARI (1-rasmdagidek) ──────────────────────────────────
  const TITLE_BG      = isGreen ? '00B050' : '4472C4'; // to'q ko'k/yashil — sarlavha
  const HEADER_BG     = '9FC5E8';                       // #9fc5e8 — fan nomlari header
  const SUBHEADER_BG  = 'CFE2F3';                       // och ko'k — 1-10, 11-20, 21-30
  const FOIZI_BG      = 'FAB97B';                       // to'q sariq/to'q sariq — Foizi ustuni
  const AVG_ROW_BG    = 'FFF2CC';                       // sariq — o'rtacha qatori
  const WHITE         = 'FFFFFF';                       // oq — data qatorlar

  // ── MATN RANGLARI ─────────────────────────────────────────────────
  const TITLE_TEXT  = 'FFFFFF'; // oq — sarlavha matni
  const HEADER_TEXT = '1F3864'; // to'q ko'k — header matni
  const BLACK       = '000000'; // qora — data matni

  const thinBorder: Partial<ExcelJS.Borders> = {
    top:    { style: 'thin', color: { argb: 'FF000000' } },
    left:   { style: 'thin', color: { argb: 'FF000000' } },
    bottom: { style: 'thin', color: { argb: 'FF000000' } },
    right:  { style: 'thin', color: { argb: 'FF000000' } },
  };

  const ws = workbook.addWorksheet(className);

  // Ustun kengliklari
  ws.columns = [
    { width: 5  }, // №
    { width: 18 }, // Familiya
    { width: 14 }, // Ism
    { width: 5  }, { width: 6  }, { width: 6  }, { width: 7  }, // Ona tili
    { width: 5  }, { width: 6  }, { width: 6  }, { width: 7  }, // Matematika
    { width: 5  }, { width: 6  }, { width: 6  }, { width: 7  }, // Ingliz tili
    { width: 5  }, { width: 6  }, { width: 6  }, { width: 7  }, // Rus tili
    { width: 11 }, { width: 7  }, { width: 8  },                // Ortacha, Jarima, Umumiy
  ];

  // ── QATOR 1: Sarlavha (to'q ko'k/yashil fon, oq matn) ────────────
  ws.mergeCells('A1:V1');
  const titleCell = ws.getCell('A1');
  titleCell.value = `${displayName} haftalik imtihin`;
  titleCell.font = { bold: true, size: 14, color: { argb: 'FF' + TITLE_TEXT } };
  titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + TITLE_BG } };
  titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
  titleCell.border = thinBorder;
  ws.getRow(1).height = 22;

  // ── QATOR 2: Asosiy ustun sarlavhalari (merged) ───────────────────
  ws.mergeCells('A2:A3');
  ws.mergeCells('B2:B3');
  ws.mergeCells('C2:C3');
  ws.mergeCells('D2:G2');
  ws.mergeCells('H2:K2');
  ws.mergeCells('L2:O2');
  ws.mergeCells('P2:S2');
  ws.mergeCells('T2:T3');
  ws.mergeCells('U2:U3');
  ws.mergeCells('V2:V3');

  const headerLabels: [string, string][] = [
    ['A2', '№'], ['B2', "O'quvchining\nfamiliyasi"], ['C2', "O'quvchining\nismi"],
    ['D2', 'Ona tili\n(50)'], ['H2', 'Matematika\n(50)'],
    ['L2', 'Ingliz tili\n(50)'], ['P2', 'Rus tili\n(50)'],
    ['T2', "O'rtacha\no'zlashtirish %"], ['U2', "Jarima\nbali"], ['V2', "Umumiy\n%"],
  ];
  for (const [addr, val] of headerLabels) {
    const cell = ws.getCell(addr);
    cell.value = val;
    cell.font = { bold: true, size: 9, color: { argb: 'FF' + HEADER_TEXT } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + HEADER_BG } };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.border = thinBorder;
  }
  ws.getRow(2).height = 18;

  // ── QATOR 3: Sub-sarlavhalar (1-10, 11-20, 21-30, Foizi) ─────────
  const subHeaders = [
    'D3','E3','F3','G3', 'H3','I3','J3','K3',
    'L3','M3','N3','O3', 'P3','Q3','R3','S3',
  ];
  const subLabels = [
    '1-10','11-20','21-30','Foizi', '1-10','11-20','21-30','Foizi',
    '1-10','11-20','21-30','Foizi', '1-10','11-20','21-30','Foizi',
  ];
  subHeaders.forEach((addr, idx) => {
    const cell = ws.getCell(addr);
    const isFoizi = subLabels[idx] === 'Foizi';
    cell.value = subLabels[idx];
    cell.font = { bold: true, size: 8, color: { argb: 'FF' + HEADER_TEXT } };
    cell.fill = { type: 'pattern', pattern: 'solid',
      fgColor: { argb: 'FF' + (isFoizi ? FOIZI_BG : SUBHEADER_BG) } };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.border = thinBorder;
  });
  // A3, B3, C3 — A2:A3, B2:B3, C2:C3 merge slave hujayralar, asosiy rang bilan mos bo'lishi kerak
  ['A3','B3','C3'].forEach(addr => {
    const cell = ws.getCell(addr);
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + HEADER_BG } };
    cell.border = thinBorder;
  });
  ws.getRow(3).height = 18;

  // ── QATORLAR 4+: O'quvchilar ──────────────────────────────────────
  let totalRows = 0;
  students.forEach((s, i) => {
    const ona = r(s.ona_1_10) + r(s.ona_11_20) + r(s.ona_21_30);
    const mat = r(s.mat_1_10) + r(s.mat_11_20) + r(s.mat_21_30);
    const ing = r(s.ing_1_10) + r(s.ing_11_20) + r(s.ing_21_30);
    const rus = r(s.rus_1_10) + r(s.rus_11_20) + r(s.rus_21_30);
    const totalScore = ona + mat + ing + rus;
    
    const onaF = +((ona / 30) * 100).toFixed(1);
    const matF = +((mat / 30) * 100).toFixed(1);
    const ingF = +((ing / 30) * 100).toFixed(1);
    const rusF = +((rus / 30) * 100).toFixed(1);
    const avg  = +((onaF + matF + ingF + rusF) / 4).toFixed(1);

    const isAbsent = totalScore === 0;

    const values = [
      i + 1,
      (s.familiya || '').toUpperCase(),
      (s.ism      || '').toUpperCase(),
      r(s.ona_1_10), r(s.ona_11_20), r(s.ona_21_30), onaF,
      r(s.mat_1_10), r(s.mat_11_20), r(s.mat_21_30), matF,
      r(s.ing_1_10), r(s.ing_11_20), r(s.ing_21_30), ingF,
      r(s.rus_1_10), r(s.rus_11_20), r(s.rus_21_30), rusF,
      avg, 0, avg,
    ];

    const rowNum = 4 + i;
    const row = ws.getRow(rowNum);
    row.height = 14;
    
    if (isAbsent) {
      // 1-3 ustunlar: No, Familiya, Ism
      for (let c = 0; c < 3; c++) {
        const cell = row.getCell(c + 1);
        cell.value = values[c];
        cell.font = { size: 9, color: { argb: 'FF' + BLACK } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + WHITE } };
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        cell.border = thinBorder;
      }
      
      // Merge D to V (4 to 22)
      ws.mergeCells(`D${rowNum}:V${rowNum}`);
      const mergedCell = row.getCell(4);
      mergedCell.value = 'qatnashmadi';
      mergedCell.font = { size: 9, color: { argb: 'FF' + BLACK } };
      mergedCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + WHITE } };
      mergedCell.alignment = { horizontal: 'center', vertical: 'middle' };
      
      // ExcelJS mergeCell qilganda butun blok atrofida border saqlanishi uchun
      // hamma kataklarga border berish tavsiya qilinadi
      for (let c = 4; c <= 22; c++) {
        row.getCell(c).border = thinBorder;
      }
    } else {
      values.forEach((val, colIdx) => {
        const cell = row.getCell(colIdx + 1);
        cell.value = val;
        // colIdx 0-based: 6=onaF, 10=matF, 14=ingF, 18=rusF, 19=avg, 21=umumiy — Foizi ustunlari
        const isFoiziCol = [6, 10, 14, 18, 19, 21].includes(colIdx);
        cell.font = { size: 9, color: { argb: 'FF' + BLACK }, bold: isFoiziCol };
        cell.fill = { type: 'pattern', pattern: 'solid',
          fgColor: { argb: 'FF' + (isFoiziCol ? FOIZI_BG : WHITE) } };
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        cell.border = thinBorder;
      });
    }

    totalRows++;
  });

  // ── OXIRGI QATOR: O'rtacha o'zlashtirish ─────────────────────────
  const avgRowNum = 4 + totalRows;
  const avgRow = ws.getRow(avgRowNum);
  avgRow.height = 16;

  ws.mergeCells(`A${avgRowNum}:C${avgRowNum}`);
  const avgLabelCell = ws.getCell(`A${avgRowNum}`);
  avgLabelCell.value = "O'RTACHA O'ZLASHTIRISH";
  avgLabelCell.font = { bold: true, size: 9, italic: true, color: { argb: 'FF' + BLACK } };
  avgLabelCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + AVG_ROW_BG } };
  avgLabelCell.alignment = { horizontal: 'center', vertical: 'middle' };
  avgLabelCell.border = thinBorder;

  // Foiz ustunlari o'rtachasi (1-based): G=7, K=11, O=15, S=19, T=20, V=22
  const foiziCols = [7, 11, 15, 19, 20, 22];
  for (let col = 1; col <= 22; col++) {
    const cell = avgRow.getCell(col);
    if (col <= 3) { cell.border = thinBorder; continue; }
    const isFoiziCol = foiziCols.includes(col);
    if (isFoiziCol) {
      let sum = 0, cnt = 0;
      for (let rowN = 4; rowN < avgRowNum; rowN++) {
        const v = parseFloat(String(ws.getRow(rowN).getCell(col).value || '0'));
        if (v > 0) { sum += v; cnt++; }
      }
      cell.value = cnt > 0 ? +(sum / cnt).toFixed(1) : 0;
      cell.font = { bold: true, size: 9, color: { argb: 'FF' + BLACK } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + FOIZI_BG } };
    } else {
      cell.font = { size: 9, color: { argb: 'FF' + BLACK } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + AVG_ROW_BG } };
    }
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.border = thinBorder;
  }
}


async function generateSheetData(modelName: string, genAI: GoogleGenerativeAI, className: string): Promise<any[]> {
  const model = genAI.getGenerativeModel({
    model: modelName,
    generationConfig: { responseMimeType: "application/json" }
  });
  const result = await model.generateContent(buildPrompt(className));
  const text = result.response.text();
  if (!text) throw new Error('Bo\'sh javob');
  const parsed = JSON.parse(text);
  return Array.isArray(parsed) ? parsed : (parsed.students || parsed.data || []);
}

async function generateExcelData(): Promise<Record<string, any[]>> {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
  const result: Record<string, any[]> = {};
  const errors: string[] = [];

  for (const className of CLASS_SHEETS) {
    let sheetDone = false;

    for (const modelName of AI_MODELS) {
      try {
        console.log(`[AI] "${className}" sinfi → "${modelName}" modeli bilan...`);
        const data = await generateSheetData(modelName, genAI, className);
        result[className] = data;
        console.log(`[AI] ✅ "${className}" tayyor (${data.length} ta o'quvchi, model: ${modelName})`);
        sheetDone = true;
        break; // Bu sinf tayyor, keyingi sinfga o'tish
      } catch (error: any) {
        const status = error.status || error.response?.status || '?';
        console.warn(`[AI] ✗ "${className}" → "${modelName}" ishlamadi (${status}): ${error.message?.slice(0, 80)}`);
        // Keyingi modelni sinab ko'rish
      }
    }

    if (!sheetDone) {
      errors.push(className);
      console.error(`[AI] ❌ "${className}" sinfi uchun hech bir model ishlamadi!`);
      // Bo'sh varaq qo'shamiz (hech bo'lmasa varaq bo'lsin)
      result[className] = [{ 'Xato': 'Ma\'lumot olinmadi' }];
    }
  }

  if (errors.length > 0) {
    console.warn(`[AI] Quyidagi sinflar uchun ma'lumot olinmadi: ${errors.join(', ')}`);
  }

  return result;
}

// Upload to Google Drive (OAuth2 orqali)
async function uploadToDrive(buffer: Buffer, filename: string) {
  const oauth2Client = getOAuthClient();
  try {
    const tokens = await loadTokens();
    if (!tokens) throw new Error('Token topilmadi');
    oauth2Client.setCredentials(tokens);
  } catch (e) {
    throw new Error('Google hisobiga ulanmagansiz. Iltimos, avval ulaning.');
  }

  const drive = google.drive({ version: 'v3', auth: oauth2Client });
  const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
  
  const fileMetadata: any = {
    name: filename,
  };
  if (folderId) {
    fileMetadata.parents = [folderId];
  }
  
  const media = {
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    body: Readable.from(buffer)
  };
  
  const file = await drive.files.create({
    requestBody: fileMetadata,
    media: media,
    fields: 'id, webViewLink'
  });

  console.log(`[Drive] Fayl yuklandi: ${file.data.webViewLink}`);
  return file.data;
}

// Bitta kanalga xabar yuborish (xabar uzunligini hisobga olgan holda bo'lib yuboradi)
async function sendToSingleChat(bot: TelegramBot, chatId: string, message: string): Promise<void> {
  const MAX_LEN = 4000;
  const isPlainUrl = /^https?:\/\/[^\s]+$/.test(message.trim());

  if (message.length <= MAX_LEN) {
    if (isPlainUrl) {
      // Faqat URL — hech qanday option bermaymiz
      // Telegram o'zi Google Docs preview kartasini ko'rsatadi
      await bot.sendMessage(chatId, message);
    } else {
      await bot.sendMessage(chatId, message, {
        parse_mode: 'HTML',
        disable_web_page_preview: false
      });
    }
    return;
  }

  // Uzun xabarni qatorlarga bo'lib yuboramiz
  let currentChunk = '';
  const lines = message.split('\n');

  for (const line of lines) {
    if (line.length > MAX_LEN) {
      if (currentChunk) {
        await bot.sendMessage(chatId, currentChunk, { parse_mode: 'HTML', disable_web_page_preview: false });
        currentChunk = '';
      }
      for (let i = 0; i < line.length; i += MAX_LEN) {
        await bot.sendMessage(chatId, line.substring(i, i + MAX_LEN), { parse_mode: 'HTML', disable_web_page_preview: false });
      }
    } else if (currentChunk.length + line.length + 1 > MAX_LEN) {
      await bot.sendMessage(chatId, currentChunk, { parse_mode: 'HTML', disable_web_page_preview: false });
      currentChunk = line + '\n';
    } else {
      currentChunk += line + '\n';
    }
  }

  if (currentChunk.trim().length > 0) {
    await bot.sendMessage(chatId, currentChunk, { parse_mode: 'HTML', disable_web_page_preview: false });
  }
}

async function getUserbotClient() {
  try {
    const db = await readDB();
    if (db.userbotSession && db.userbotSession.sessionStr) {
      const session = new StringSession(db.userbotSession.sessionStr);
      const client = new TelegramClient(session, parseInt(db.userbotSession.apiId), db.userbotSession.apiHash, {
        connectionRetries: 3,
      });
      return client;
    }
  } catch (e) {
    console.error("[USERBOT] Client yaratishda xatolik:", (e as Error).message);
  }
  return null;
}

async function connectUserbot(client: TelegramClient) {
  await client.connect();
  try {
    await client.getDialogs({ limit: 100 });
  } catch (e: any) {
    console.warn("[USERBOT] Dialoglarni yuklashda xatolik:", e.message);
  }
}

// Link preview kartasini ko'rsatib xabar yuborish
async function sendLinkWithPreview(chatId: string, text: string, linkUrl: string): Promise<void> {
  const userbot = await getUserbotClient();
  if (userbot) {
    try {
      console.log(`[Telegram] [USERBOT] Link yuborilmoqda: ${chatId}`);
      await connectUserbot(userbot);
      await userbot.sendMessage(chatId, { message: text });
      await userbot.disconnect();
      return; // Shaxsiy profil orqali muvaffaqiyatli yuborildi
    } catch (err: any) {
      console.error(`[Telegram] [USERBOT] Yuborishda xato, BOT orqali yuboriladi: ${err.message}`);
    }
  }

  // Fallback: Telegram Bot
  const bot = new TelegramBot(constants.telegramBotToken, { polling: false });
  await bot.sendMessage(chatId, text, {
    disable_web_page_preview: false,
    link_preview_options: {
      is_disabled: false,
      prefer_large_media: true,
      url: linkUrl
    }
  } as any);
}


// specificChatId berilsa — faqat shu kanalga, berilmasa — barchasiga
async function sendToTelegram(message: string, specificChatId?: string, forceBot: boolean = false) {
  const chatIds = specificChatId ? [specificChatId] : constants.telegramChatIds;

  if (!forceBot) {
    const userbot = await getUserbotClient();
    if (userbot) {
      try {
        console.log(`[Telegram] [USERBOT] ${chatIds.length} ta kanalga xabar yuborishga urinilmoqda...`);
        await connectUserbot(userbot);
        
        let successCount = 0;
        for (const chatId of chatIds) {
          try {
            await userbot.sendMessage(chatId, { message });
            successCount++;
            console.log(`[Telegram] [USERBOT] ✅ Kanal ${chatId} — yuborildi.`);
          } catch (e: any) {
            console.error(`[Telegram] [USERBOT] ❌ Kanal ${chatId} — xato: ${e.message}`);
          }
        }
        
        await userbot.disconnect();
        
        if (successCount > 0) {
          console.log(`[Telegram] [USERBOT] Natija: ${successCount}/${chatIds.length} ta kanalga profilingizdan yuborildi.`);
          return; // Muvaffaqiyatli
        }
        console.log("[Telegram] [USERBOT] Profil orqali birorta ham guruhga xabar ketmadi, BOT ga o'tiladi.");
      } catch (err: any) {
        console.error(`[Telegram] [USERBOT] Umumiy xato, BOT ga o'tilmoqda: ${err.message}`);
      }
    }
  }

  // Fallback: Telegram Bot
  if (!constants.telegramBotToken || chatIds.length === 0) {
    console.warn("[Telegram] ⚠️ Token yoki Chat ID(lar) sozlanmagan! .env faylini tekshiring.");
    return;
  }

  const bot = new TelegramBot(constants.telegramBotToken, { polling: false });
  console.log(`[Telegram] [BOT] 📤 ${chatIds.length} ta kanalga xabar yuborilmoqda...`);

  const results = await Promise.allSettled(
    chatIds.map(chatId => sendToSingleChat(bot, chatId, message))
  );

  let successCount = 0;
  results.forEach((result, idx) => {
    if (result.status === 'fulfilled') {
      successCount++;
      console.log(`[Telegram] [BOT] ✅ Kanal ${chatIds[idx]} — yuborildi.`);
    } else {
      console.error(`[Telegram] [BOT] ❌ Kanal ${chatIds[idx]} — xato: ${result.reason?.message || result.reason}`);
    }
  });

  console.log(`[Telegram] [BOT] Natija: ${successCount}/${chatIds.length} ta kanalga muvaffaqiyatli yuborildi.`);

  if (successCount === 0) {
    throw new Error(`Hech qaysi kanalga xabar yuborib bo'lmadi (${chatIds.length} ta sinab ko'rildi).`);
  }
}

// Telegramga rasm yuborish
async function sendPhotoToTelegram(photoBuffer: Buffer, caption: string, specificChatId?: string) {
  const chatIds = specificChatId ? [specificChatId] : constants.telegramChatIds;

  const userbot = await getUserbotClient();
  if (userbot) {
    try {
      console.log(`[Telegram] [USERBOT] 📸 ${chatIds.length} ta kanalga rasm yuborishga urinilmoqda...`);
      await connectUserbot(userbot);
      
      const { CustomFile } = await import("telegram/client/uploads.js");
      const toSend = new CustomFile("report.png", photoBuffer.length, "", photoBuffer);

      let successCount = 0;
      for (const chatId of chatIds) {
        try {
          await userbot.sendFile(chatId, {
            file: toSend,
            caption: caption
          });
          successCount++;
          console.log(`[Telegram] [USERBOT] ✅ Kanal ${chatId} — rasm yuborildi.`);
        } catch (e: any) {
          console.error(`[Telegram] [USERBOT] ❌ Kanal ${chatId} — rasm xatosi: ${e.message}`);
        }
      }
      
      await userbot.disconnect();
      
      if (successCount > 0) {
        console.log(`[Telegram] [USERBOT] Natija: ${successCount}/${chatIds.length} ta kanalga profilingizdan rasm yuborildi.`);
        return; // Muvaffaqiyatli
      }
      console.log("[Telegram] [USERBOT] Profil orqali birorta ham guruhga rasm ketmadi, BOT ga o'tiladi.");
    } catch (err: any) {
      console.error(`[Telegram] [USERBOT] Umumiy rasm xatosi, BOT ga o'tilmoqda: ${err.message}`);
    }
  }

  // Fallback: Telegram Bot
  if (!constants.telegramBotToken || chatIds.length === 0) {
    console.warn("[Telegram] ⚠️ Token yoki Chat ID(lar) sozlanmagan! .env faylini tekshiring.");
    return;
  }

  const bot = new TelegramBot(constants.telegramBotToken, { polling: false });
  console.log(`[Telegram] [BOT] 📸 ${chatIds.length} ta kanalga rasm yuborilmoqda...`);

  const results = await Promise.allSettled(
    chatIds.map(async (chatId) => {
      try {
        await bot.sendPhoto(chatId, photoBuffer, { caption, parse_mode: 'HTML' }, { filename: 'report.png', contentType: 'image/png' });
        console.log(`[Telegram] [BOT] ✅ Kanal ${chatId} — rasm yuborildi.`);
      } catch (error: any) {
        console.error(`[Telegram] [BOT] ❌ Kanal ${chatId} — rasm xatosi: ${error.message || error}`);
        if (error.message && error.message.includes('PHOTO_INVALID_DIMENSIONS')) {
          console.log(`[Telegram] [BOT] 🔄 Kanal ${chatId} — Rasm o'lchami katta, hujjat (document) sifatida yuborilmoqda...`);
          await bot.sendDocument(chatId, photoBuffer, { caption }, { filename: 'report.png', contentType: 'image/png' });
          console.log(`[Telegram] [BOT] ✅ Kanal ${chatId} — hujjat sifatida yuborildi.`);
        } else {
          throw error;
        }
      }
    })
  );

  const successCount = results.filter(r => r.status === 'fulfilled').length;

  if (successCount === 0) {
    throw new Error(`Hech qaysi kanalga rasm yuborib bo'lmadi.`);
  }
}

let isJobRunning = false;
let isAnalyzeRunning = false;

// Juma kuni: haftalik imtihon baholarini tozalash va o'qituvchilar guruhiga xabar berish
async function runJob() {
  if (isJobRunning) {
    console.log("[JOB] ⚠️ Job allaqachon ishlamoqda. Yangi ishga tushirish bekor qilindi.");
    throw new Error("Hisobotni tozalash jarayoni allaqachon bajarilmoqda. Iltimos, u tugashini kuting.");
  }
  isJobRunning = true;
  console.log("\n===== JOB BOSHLANDI =====");

  // O'qituvchilar guruhi — TELEGRAM_CHANNEL_1
  const teachersChatId = (process.env.TELEGRAM_CHANNEL_1 || '').trim();

  try {
    if (!constants.targetExcelLink) {
      throw new Error("TARGET_EXCEL_LINK .env faylida ko'rsatilmagan.");
    }
    const fileId = getFileIdFromLink(constants.targetExcelLink);
    if (!fileId) {
      throw new Error("Linkdan Fayl ID sini ajratib bo'lmadi.");
    }

    console.log(`[JOB] 1/3 - Drive'dan fayl olinmoqda (ID: ${fileId})...`);
    
    const oauth2Client = getOAuthClient();
    try {
      const tokens = await loadTokens();
      if (!tokens) throw new Error('Token topilmadi');
      oauth2Client.setCredentials(tokens);
    } catch (e) {
      throw new Error('Google hisobiga ulanmagansiz. Iltimos, avval ulaning.');
    }
    const drive = google.drive({ version: 'v3', auth: oauth2Client });

    // Faylni yuklab olish
    const res = await drive.files.get({ fileId, alt: 'media' }, { responseType: 'arraybuffer' });
    const buffer = Buffer.from(res.data as ArrayBuffer) as any;

    console.log("[JOB] 2/3 - Fayldagi baholar tozalanmoqda...");
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);

    // Barcha varaqlarni aylanib chiqish
    workbook.worksheets.forEach(ws => {
      // 1-QADAM: Barcha "Shared Formula" larni oddiy formulaga aylantiramiz (xatolikni oldini olish uchun)
      ws.eachRow(row => {
        row.eachCell(cell => {
          if (cell.type === ExcelJS.ValueType.Formula) {
            cell.value = { formula: cell.formula, result: cell.result };
          }
        });
      });

      const rowCount = ws.rowCount;
      for (let i = 2; i <= rowCount; i++) {
        const row = ws.getRow(i);
        const cell1 = row.getCell(1);
        let col1Value = cell1.value;
        
        if (col1Value && typeof col1Value === 'object' && 'result' in col1Value) {
            col1Value = col1Value.result;
        }

        const isNumber = col1Value !== null && col1Value !== undefined && String(col1Value).trim() !== '' && !isNaN(Number(col1Value));

        if (isNumber) {
           const cellCount = Math.max(row.cellCount, 25);
           for (let c = 4; c <= cellCount; c++) {
             const cell = row.getCell(c);
             if (cell.type !== ExcelJS.ValueType.Formula) {
                cell.value = null;
             }
           }
        }
      }
    });

    // ===== BAHOLARNI TOZALASHDAN OLDIN SAQLASH =====
    // analyzeJob Shanba kuni shu ma'lumotlardan foydalanadi
    console.log("[JOB] 📝 Baholar last_grades.json ga saqlanmoqda...");
    const gradesSnapshot: Record<string, any[]> = {};
    workbook.worksheets.forEach(ws => {
      let percentColsInfo: { colNum: number, isOverall: boolean }[] = [];
      for (let r = 1; r <= 4; r++) {
        ws.getRow(r).eachCell((cell, colNum) => {
          const val = String(cell.value || '').toLowerCase();
          if (val.includes('%') || val.includes('foiz')) {
            const isOverall = val.includes('umumiy') || val.includes("o'rtacha") || val.includes("o`rtacha");
            if (!percentColsInfo.some(p => p.colNum === colNum)) {
              percentColsInfo.push({ colNum, isOverall });
            }
          }
        });
      }
      let percentColIndex = -1;
      percentColsInfo.forEach(p => { if (p.colNum > percentColIndex) percentColIndex = p.colNum; });
      if (percentColIndex === -1) return;

      const students: any[] = [];
      for (let i = 2; i <= ws.rowCount; i++) {
        const row = ws.getRow(i);
        let col1 = row.getCell(1).value;
        if (col1 && typeof col1 === 'object' && 'result' in col1) col1 = (col1 as any).result;
        if (col1 === null || col1 === undefined || isNaN(Number(col1))) continue;
        const fam = String(row.getCell(2).value || '').trim();
        const ism = String(row.getCell(3).value || '').trim();
        if (!fam && !ism) continue;

        // Haqiqiy baho katakchalarini tekshirish (formula emas, raqam > 0)
        let hasReal = false;
        for (let c = 4; c < percentColIndex; c++) {
          const cell = row.getCell(c);
          if (cell.type === ExcelJS.ValueType.Formula) continue;
          if (!isNaN(parseFloat(String(cell.value ?? ''))) && parseFloat(String(cell.value)) > 0) {
            hasReal = true; break;
          }
        }
        let foiz = 0;
        if (hasReal) {
          let pv = row.getCell(percentColIndex).value;
          if (pv && typeof pv === 'object' && 'result' in pv) pv = (pv as any).result;
          foiz = parseFloat(String(pv || '0')) || 0;
        }
        students.push({ ism_familiya: `${fam} ${ism}`.trim(), foiz });
      }
      gradesSnapshot[ws.name] = students;
    });
    const LAST_GRADES_PATH = path.join(process.cwd(), 'last_grades.json');
    await fs.writeFile(LAST_GRADES_PATH, JSON.stringify(gradesSnapshot, null, 2), 'utf-8');
    console.log(`[JOB] ✅ last_grades.json saqlandi (${Object.keys(gradesSnapshot).length} sinf)`);
    // ===== SAQLASH TUGADI =====

    // Tozalangan faylni buffer ga yozamiz (Drive ga yuklash uchun)
    const updatedBuffer = Buffer.from(await workbook.xlsx.writeBuffer());

    // Fayl nomini olish va haftalik raqamni oshirish
    console.log("[JOB] 3/5 - Fayl nomi o'qilmoqda...");
    const currentFileMeta = await drive.files.get({ fileId, fields: 'name, webViewLink' });
    const currentName = currentFileMeta.data.name || '';
    console.log(`[JOB] Hozirgi fayl nomi: "${currentName}"`);

    // "4-chorak 7-Haftalik.xlsx" → chorak=4, hafta=7 → yangi nom: "4-chorak 8-Haftalik.xlsx"
    let newName = currentName;
    const nameMatch = currentName.match(/^(\d+-chorak\s+)(\d+)(-Haftalik)/i);
    if (nameMatch) {
      const prefix = nameMatch[1];       // "4-chorak "
      const weekNum = parseInt(nameMatch[2]); // 7
      const suffix = nameMatch[3];       // "-Haftalik"
      const ext = currentName.slice(currentName.lastIndexOf('.')); // ".xlsx"
      const beforeExt = currentName.slice(0, currentName.lastIndexOf('.'));
      const afterSuffix = beforeExt.slice((prefix + nameMatch[2] + suffix).length); // qo'shimcha text bo'lsa
      newName = `${prefix}${weekNum + 1}${suffix}${afterSuffix}${ext}`;
      console.log(`[JOB] Yangi fayl nomi: "${newName}" (hafta: ${weekNum} → ${weekNum + 1})`);
    } else {
      console.warn(`[JOB] ⚠️ Fayl nomi kutilgan formatda emas ("X-chorak Y-Haftalik"), nom o'zgartirilmadi.`);
    }

    console.log("[JOB] 4/5 - Tozalangan fayl Drive ga qayta yuklanmoqda va nomi o'zgartirilmoqda...");
    await drive.files.update({
      fileId: fileId,
      requestBody: {
        name: newName,
      },
      media: {
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        body: Readable.from(updatedBuffer)
      }
    });

    console.log("[JOB] 4.5/5 - Google Drive'da preview rasm tayyorlanishi kutilmoqda...");
    let thumbnailGenerated = false;
    for (let attempt = 1; attempt <= 15; attempt++) {
      try {
        const check = await drive.files.get({
          fileId: fileId,
          fields: 'thumbnailLink'
        });
        if (check.data.thumbnailLink) {
          console.log(`[JOB] ✅ Google Drive preview rasm tayyor! (Urinish: ${attempt})`);
          thumbnailGenerated = true;
          break;
        }
      } catch (e) {
        console.warn(`[JOB] Preview tekshirishda xatolik:`, (e as Error).message);
      }
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    if (!thumbnailGenerated) {
      console.warn("[JOB] ⚠️ Google Drive preview rasmni 30 soniyada tayyorlay olmadi. Shunday bo'lsa ham xabar yuboriladi.");
    }

    const cleanLink = constants.targetExcelLink.replace(
      /spreadsheets\/d\/[^\/]+/,
      `spreadsheets/d/${fileId}`
    ) + `&t=${Date.now()}`;
    const messageText = `📌 Yangi haftalik imtihon fayli tayyorlandi:\n${cleanLink}`;

    console.log("[JOB] 5/5 - O'qituvchilar guruhiga (CHANNEL_1) xabar yuborilmoqda...");

    const chatIds = teachersChatId
      ? [teachersChatId]
      : constants.telegramChatIds;

    const results = await Promise.allSettled(
      chatIds.map(cid => sendLinkWithPreview(cid, messageText, cleanLink))
    );

    results.forEach((r, i) => {
      if (r.status === 'fulfilled') {
        console.log(`[Telegram] ✅ Kanal ${chatIds[i]} — yuborildi.`);
      } else {
        console.error(`[Telegram] ❌ Kanal ${chatIds[i]} — xato: ${(r as any).reason?.message}`);
      }
    });

    console.log("===== JOB MUVAFFAQIYATLI YAKUNLANDI =====");

  } catch (error) {
    const msg = (error as Error).message;
    console.error("[JOB] ❌ XATO:", msg);
    try {
      const teachersChatId = (process.env.TELEGRAM_CHANNEL_1 || '').trim();
      await sendToTelegram(`❌ Hisobot xatosi:\n${msg}`, teachersChatId || undefined);
    } catch (telegramErr: any) {
      console.error("[JOB] Telegram ga ham yuborib bo'lmadi:", telegramErr?.message);
    }
  } finally {
    isJobRunning = false;
  }
}


// Shanba kungi AI Tahlil Job (Rahbariyat guruhi uchun)
async function analyzeJob() {
  if (isAnalyzeRunning) {
    console.log("[ANALYZE] ⚠️ AI tahlil allaqachon ishlamoqda. Yangi ishga tushirish bekor qilindi.");
    throw new Error("AI tahlil jarayoni allaqachon bajarilmoqda. Iltimos, u tugashini kuting.");
  }
  isAnalyzeRunning = true;
  console.log("\n===== ANALYZE JOB BOSHLANDI =====");

  const managementChatId = (process.env.TELEGRAM_CHANNEL_2 || '').trim();
  try {
    const LAST_GRADES_PATH = path.join(process.cwd(), 'last_grades.json');

    let schoolData: Record<string, any[]>;

    // 1-usul: last_grades.json dan o'qish (Juma: Hisobot bosilgan bo'lsa)
    let usedCache = false;
    try {
      const raw = await fs.readFile(LAST_GRADES_PATH, 'utf-8');
      schoolData = JSON.parse(raw);
      usedCache = true;
      console.log(`[ANALYZE] ✅ last_grades.json topildi — ${Object.keys(schoolData).length} sinf`);
    } catch (_) {
      // 2-usul: To'g'ridan Google Drive dan o'qish
      console.log("[ANALYZE] last_grades.json yo'q — Drive'dan o'qilmoqda...");
      const fileId = getFileIdFromLink(constants.targetExcelLink);
      if (!fileId) throw new Error("TARGET_EXCEL_LINK noto'g'ri yoki ko'rsatilmagan.");

      const oauth2Client = getOAuthClient();
      try {
        const tokens = await loadTokens();
        if (!tokens) throw new Error('Token topilmadi');
        oauth2Client.setCredentials(tokens);
      } catch (e) {
        throw new Error('Google hisobiga ulanmagansiz. Iltimos, avval ulaning.');
      }
      const drive = google.drive({ version: 'v3', auth: oauth2Client });
      const res = await drive.files.get({ fileId, alt: 'media' }, { responseType: 'arraybuffer' });
      const buffer = Buffer.from(res.data as ArrayBuffer) as any;

      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(buffer);
      schoolData = {};

      workbook.worksheets.forEach(ws => {
        let percentColIndex = -1;
        for (let r = 1; r <= 4; r++) {
          ws.getRow(r).eachCell((cell, colNum) => {
            const val = String(cell.value || '').toLowerCase();
            if ((val.includes('%') || val.includes('foiz')) && colNum > percentColIndex) {
              percentColIndex = colNum;
            }
          });
        }
        if (percentColIndex === -1) return;

        const students: any[] = [];
        for (let i = 2; i <= ws.rowCount; i++) {
          const row = ws.getRow(i);
          let col1 = row.getCell(1).value;
          if (col1 && typeof col1 === 'object' && 'result' in col1) col1 = (col1 as any).result;
          if (!col1 || isNaN(Number(col1))) continue;
          const fam = String(row.getCell(2).value || '').trim();
          const ism = String(row.getCell(3).value || '').trim();
          if (!fam && !ism) continue;

          // Faqat formula bo'lmagan haqiqiy baho katakchalarini tekshiramiz
          let hasReal = false;
          for (let c = 4; c < percentColIndex; c++) {
            const cell = row.getCell(c);
            if (cell.type === ExcelJS.ValueType.Formula) continue;
            const n = parseFloat(String(cell.value ?? ''));
            if (!isNaN(n) && n > 0) { hasReal = true; break; }
          }

          let foiz = 0;
          if (hasReal) {
            let pv = row.getCell(percentColIndex).value;
            if (pv && typeof pv === 'object' && 'result' in pv) pv = (pv as any).result;
            foiz = parseFloat(String(pv || '0')) || 0;
          }
          students.push({ ism_familiya: `${fam} ${ism}`.trim(), foiz });
        }
        schoolData[ws.name] = students;
      });
      console.log(`[ANALYZE] ✅ Drive'dan ${Object.keys(schoolData).length} sinf o'qildi`);
    }

    // Sinf nomini o'zgartirish — tartib muhim: tib b dan oldin bo'lishi kerak!
    function formatClassName(name: string): string {
      const n = name.trim();
      if (/^\d+tib$/i.test(n))   return n.replace(/^(\d+)tib$/i, '$1-tibbiyot');
      if (/^\d+b$/i.test(n))     return n.replace(/^(\d+)b$/i,   '$1-blue');
      if (/^\d+g$/i.test(n))     return n.replace(/^(\d+)g$/i,   '$1-green');
      if (/^\d+$/.test(n))       return n + '-blue';
      return n;
    }

    // Sinflarni tartibga solish: raqam bo'yicha o'sish tartibida, tibbiyot har doim oxirida
    const sortedSchoolData: Record<string, any[]> = {};
    Object.entries(schoolData)
      .map(([className, students]) => {
        const formatted = formatClassName(className);
        const isTib = /tibbiyot/i.test(formatted);
        const num = parseInt(className.match(/\d+/)?.[0] ?? '999');
        return { className, formatted, students, isTib, num };
      })
      .sort((a, b) => {
        if (a.isTib !== b.isTib) return a.isTib ? 1 : -1; // tibbiyot oxirida
        return a.num - b.num; // raqam bo'yicha o'sish
      })
      .forEach(({ formatted, students }) => {
        sortedSchoolData[formatted] = students;
      });

    console.log(`[ANALYZE] Topilgan sinflar (tartib): ${Object.keys(sortedSchoolData).join(', ')}`);

    if (Object.keys(sortedSchoolData).length === 0) {
      throw new Error("Tahlil qilish uchun hech qanday o'quvchi ma'lumoti topilmadi. (Ehtimol '%' ustuni topilmagan)");
    }

    console.log("[ANALYZE] 3/4 - AI orqali tahlil qilinmoqda...");
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

    const prompt = `Har bir sinf uchun quyidagilarni yozing:

QOIDA: Agar sinf uchun berilgan ro'yxat bo'sh bo'lsa ([] yoki hech kim yo'q) — faqat sinf nomini va "Baholar kiritilmagan" deb yozing. O'rinlar ko'rsatmang.

Agar ro'yxatda o'quvchilar bor bo'lsa:
- 🥇 1-o'rin: Eng yuqori foizli o'quvchi(lar)
- 2-o'rin: Ikkinchi yuqori foizlilar
- ‼️ 50% dan past: 0% dan yuqori lekin 50% dan past baholar

Hech qanday ortiqcha so'zlar, salomlashish yoki izoh YOZMANG. Faqat qisqa ro'yxat.

Ma'lumotlar:
${JSON.stringify(sortedSchoolData, null, 2)}`;


    let aiText = '';
    let aiSuccess = false;
    // Eng kuchli modellardan boshlab sinab ko'ramiz
    for (const modelName of [...AI_MODELS].reverse()) {
      try {
        console.log(`[ANALYZE] AI Model sinalmoqda: ${modelName}`);
        const model = genAI.getGenerativeModel({ model: modelName });
        const result = await model.generateContent(prompt);
        aiText = result.response.text();
        aiSuccess = true;
        console.log(`[ANALYZE] ✅ Model ish berdi: ${modelName}`);
        break;
      } catch (err: any) {
        const status = err.status || err.response?.status || '?';
        console.warn(`[ANALYZE] ✗ Model xatosi (${modelName}) [Status: ${status}]: ${err.message}`);
      }
    }

    if (!aiSuccess) {
      throw new Error("Hech qaysi AI modeli ishlamadi. API kalitingizni (Project access) tekshiring.");
    }

     console.log("[ANALYZE] 4/5 - Rahbariyat guruhiga (CHANNEL_2) xabar yuborilmoqda...");
    await sendToTelegram(
      `📊 *Haftalik Imtihon Tahlili*\n\n${aiText}`,
      managementChatId || undefined, // CHANNEL_2 (rahbariyat guruhi)
      true // forceBot = true (always send via Telegram Bot)
    );


    console.log("===== ANALYZE JOB MUVAFFAQIYATLI YAKUNLANDI =====");
  } catch (error) {
    const msg = (error as Error).message;
    console.error("[ANALYZE] ❌ XATO:", msg);
    try {
      await sendToTelegram(`❌ Tahlil xatosi:\n${msg}`, managementChatId || undefined, true);
    } catch (e) {}
  } finally {
    isAnalyzeRunning = false;
  }
}

// Cron job set to every Friday at 17:00 (5 PM)
cron.schedule('0 17 * * 5', () => {
  runJob();
});


// Cron job for AI analysis every Saturday at 18:00 (6 PM)
cron.schedule('0 18 * * 6', () => {
  analyzeJob();
});

// Trigger manually for testing
app.post('/api/trigger', async (req, res) => {
  try {
    await runJob();
    res.json({ success: true, message: 'Ishga tushdi' });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// Shanba: AI tahlilni qo'lda ishga tushirish
app.post('/api/analyze', async (req, res) => {
  try {
    await analyzeJob();
    res.json({ success: true, message: 'AI tahlil muvaffaqiyatli bajarildi' });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

function getCellValue(cell: any): any {
  if (!cell) return '';
  const val = cell.value;
  if (val && typeof val === 'object') {
    if ('result' in val) return val.result;
    if ('sharedFormula' in val) return val.result;
  }
  return val === null || val === undefined ? '' : val;
}

function generateSheetHtml(ws: any, sheetName: string): string {
  const isGreen = sheetName.endsWith('g');
  const isTib = sheetName.toLowerCase().includes('tib');
  
  let theme = {
    primary: 'from-blue-600 to-indigo-800',
    text: 'text-indigo-900',
    bgLight: 'bg-indigo-50/50',
    bgHeader: 'bg-indigo-100/80',
    border: 'border-indigo-200',
    accent: 'bg-amber-100 text-amber-900',
    foizi: 'bg-amber-50 text-amber-950 font-bold',
  };

  if (isGreen) {
    theme = {
      primary: 'from-emerald-600 to-green-800',
      text: 'text-green-900',
      bgLight: 'bg-green-50/50',
      bgHeader: 'bg-green-100/80',
      border: 'border-green-200',
      accent: 'bg-amber-100 text-amber-900',
      foizi: 'bg-amber-50 text-amber-950 font-bold',
    };
  } else if (isTib) {
    theme = {
      primary: 'from-purple-600 to-fuchsia-800',
      text: 'text-purple-900',
      bgLight: 'bg-purple-50/50',
      bgHeader: 'bg-purple-100/80',
      border: 'border-purple-200',
      accent: 'bg-amber-100 text-amber-900',
      foizi: 'bg-amber-50 text-amber-950 font-bold',
    };
  }

  const title = getCellValue(ws.getCell('A1')) || `${sheetName.toUpperCase()} haftalik imtihon`;

  let studentHtmlRows = '';
  let averageHtmlRow = '';

  const rowCount = ws.rowCount;
  for (let i = 4; i <= rowCount; i++) {
    const row = ws.getRow(i);
    let col1 = getCellValue(row.getCell(1));
    
    if (!col1) continue;

    if (String(col1).includes("O'RTACHA")) {
      const avgG = getCellValue(row.getCell(7)) || '0';
      const avgK = getCellValue(row.getCell(11)) || '0';
      const avgO = getCellValue(row.getCell(15)) || '0';
      const avgS = getCellValue(row.getCell(19)) || '0';
      const avgT = getCellValue(row.getCell(20)) || '0';
      const avgV = getCellValue(row.getCell(22)) || '0';
      
      averageHtmlRow = `
        <tr class="h-11 bg-amber-50/70 font-bold text-slate-900 border-t border-slate-300">
          <td colspan="3" class="border-r border-slate-200 text-center font-bold italic py-2.5">O'RTACHA O'ZLASHTIRISH</td>
          <td colspan="3" class="border-r border-slate-200"></td>
          <td class="border-r border-slate-200 text-amber-800 bg-amber-50 font-extrabold text-[12px]">${avgG}%</td>
          <td colspan="3" class="border-r border-slate-200"></td>
          <td class="border-r border-slate-200 text-amber-800 bg-amber-50 font-extrabold text-[12px]">${avgK}%</td>
          <td colspan="3" class="border-r border-slate-200"></td>
          <td class="border-r border-slate-200 text-amber-800 bg-amber-50 font-extrabold text-[12px]">${avgO}%</td>
          <td colspan="3" class="border-r border-slate-200"></td>
          <td class="border-r border-slate-200 text-amber-800 bg-amber-50 font-extrabold text-[12px]">${avgS}%</td>
          <td class="border-r border-slate-200 text-amber-800 bg-amber-50 font-extrabold text-[12px]">${avgT}%</td>
          <td class="border-r border-slate-200"></td>
          <td class="bg-amber-100 text-amber-950 font-black text-[13px]">${avgV}%</td>
        </tr>
      `;
      break;
    }

    const num = col1;
    const lastName = getCellValue(row.getCell(2)) || '';
    const firstName = getCellValue(row.getCell(3)) || '';
    const isAbsent = getCellValue(row.getCell(4)) === 'qatnashmadi';

    if (isAbsent) {
      studentHtmlRows += `
        <tr class="h-9 hover:bg-slate-50/80 transition-colors">
          <td class="border-r border-slate-200 py-2 text-slate-400 font-bold">${num}</td>
          <td class="border-r border-slate-200 text-left px-4 font-bold text-slate-800">${lastName}</td>
          <td class="border-r border-slate-200 text-left px-4 font-bold text-slate-800">${firstName}</td>
          <td colspan="19" class="text-center font-bold text-slate-400 italic bg-slate-50/50 tracking-wider">qatnashmadi</td>
        </tr>
      `;
    } else {
      const scores = [];
      for (let c = 4; c <= 22; c++) {
        scores.push(getCellValue(row.getCell(c)) || '0');
      }

      studentHtmlRows += `
        <tr class="h-9 hover:bg-slate-50/80 transition-colors">
          <td class="border-r border-slate-200 py-2 text-slate-400 font-bold">${num}</td>
          <td class="border-r border-slate-200 text-left px-4 font-bold text-slate-800">${lastName}</td>
          <td class="border-r border-slate-200 text-left px-4 font-bold text-slate-800">${firstName}</td>
          
          <td class="border-r border-slate-200">${scores[0]}</td>
          <td class="border-r border-slate-200">${scores[1]}</td>
          <td class="border-r border-slate-200">${scores[2]}</td>
          <td class="border-r border-slate-200 ${theme.foizi}">${scores[3]}%</td>
          
          <td class="border-r border-slate-200">${scores[4]}</td>
          <td class="border-r border-slate-200">${scores[5]}</td>
          <td class="border-r border-slate-200">${scores[6]}</td>
          <td class="border-r border-slate-200 ${theme.foizi}">${scores[7]}%</td>
          
          <td class="border-r border-slate-200">${scores[8]}</td>
          <td class="border-r border-slate-200">${scores[9]}</td>
          <td class="border-r border-slate-200">${scores[10]}</td>
          <td class="border-r border-slate-200 ${theme.foizi}">${scores[11]}%</td>
          
          <td class="border-r border-slate-200">${scores[12]}</td>
          <td class="border-r border-slate-200">${scores[13]}</td>
          <td class="border-r border-slate-200">${scores[14]}</td>
          <td class="border-r border-slate-200 ${theme.foizi}">${scores[15]}%</td>
          
          <td class="border-r border-slate-200 ${theme.foizi}">${scores[16]}%</td>
          <td class="border-r border-slate-200 text-red-600 font-bold">${scores[17]}</td>
          <td class="bg-amber-50 text-amber-950 font-black">${scores[18]}%</td>
        </tr>
      `;
    }
  }

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <script src="https://cdn.tailwindcss.com"></script>
      <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;700;800;900&display=swap" rel="stylesheet">
      <style>
        body { font-family: 'Outfit', sans-serif; }
      </style>
    </head>
    <body class="bg-slate-900 p-6 flex justify-center items-center">
      <div id="capture-target" class="w-[1250px] bg-white rounded-3xl overflow-hidden shadow-2xl border border-slate-200 p-6">
        <div class="bg-linear-to-r ${theme.primary} text-white text-center py-6 px-8 rounded-2xl mb-6 shadow-md">
          <h1 class="text-3xl font-black tracking-wide uppercase">${title}</h1>
          <p class="text-indigo-100 text-sm mt-1.5 font-semibold">Haftalik imtihon natijalari hisoboti</p>
        </div>
        <div class="overflow-hidden rounded-2xl border border-slate-200 shadow-sm bg-white">
          <table class="w-full text-center border-collapse text-[11px] font-semibold text-slate-700">
            <thead class="${theme.bgHeader} ${theme.text} font-bold text-[11px] uppercase tracking-wider">
              <tr class="h-12 border-b border-slate-200 text-slate-900">
                <th rowspan="2" class="border-r border-slate-200 w-10">№</th>
                <th rowspan="2" class="border-r border-slate-200 w-44 text-left px-4">O'quvchining familiyasi</th>
                <th rowspan="2" class="border-r border-slate-200 w-36 text-left px-4">O'quvchining ismi</th>
                <th colspan="4" class="border-r border-slate-200 text-center py-2 bg-slate-50/60">Ona tili (50)</th>
                <th colspan="4" class="border-r border-slate-200 text-center py-2 bg-slate-50/60">Matematika (50)</th>
                <th colspan="4" class="border-r border-slate-200 text-center py-2 bg-slate-50/60">Ingliz tili (50)</th>
                <th colspan="4" class="border-r border-slate-200 text-center py-2 bg-slate-50/60">Rus tili (50)</th>
                <th rowspan="2" class="border-r border-slate-200 w-24">O'rtacha %</th>
                <th rowspan="2" class="border-r border-slate-200 w-16">Jarima</th>
                <th rowspan="2" class="w-20 bg-amber-100 text-amber-950 font-black text-[12px]">Umumiy %</th>
              </tr>
              <tr class="h-9 text-[10px] bg-slate-50/80 border-b border-slate-200 text-slate-700">
                <th class="border-r border-slate-200">1-10</th><th class="border-r border-slate-200">11-20</th><th class="border-r border-slate-200">21-30</th><th class="border-r border-slate-200 bg-amber-50/80 font-bold">Foizi</th>
                <th class="border-r border-slate-200">1-10</th><th class="border-r border-slate-200">11-20</th><th class="border-r border-slate-200">21-30</th><th class="border-r border-slate-200 bg-amber-50/80 font-bold">Foizi</th>
                <th class="border-r border-slate-200">1-10</th><th class="border-r border-slate-200">11-20</th><th class="border-r border-slate-200">21-30</th><th class="border-r border-slate-200 bg-amber-50/80 font-bold">Foizi</th>
                <th class="border-r border-slate-200">1-10</th><th class="border-r border-slate-200">11-20</th><th class="border-r border-slate-200">21-30</th><th class="border-r border-slate-200 bg-amber-50/80 font-bold">Foizi</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100 text-[11px] font-semibold text-slate-700">
              ${studentHtmlRows}
              ${averageHtmlRow}
            </tbody>
          </table>
        </div>
        <div class="mt-4 flex items-center justify-between text-[10px] text-slate-400 font-medium px-2">
          <div>🏫 Boborahim Mashrab nomli xususiy maktab</div>
          <div>Avtomatik hisobot tizimi — Gemini AI</div>
        </div>
      </div>
    </body>
    </html>
  `;
}

async function captureHtmlAsImage(htmlContent: string): Promise<Buffer> {
  const browser = await puppeteer.launch({
    headless: true,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--font-render-hinting=none'
    ]
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1300, height: 900, deviceScaleFactor: 2 });
    await page.setContent(htmlContent, { waitUntil: 'load' });
    const element = await page.$('#capture-target');
    if (!element) throw new Error('Capture target element not found');
    const buffer = await element.screenshot({ type: 'png' });
    return buffer as Buffer;
  } finally {
    await browser.close();
  }
}

async function captureSheetScreenshot(page: any, lastCol: number): Promise<Buffer | null> {
  const iframeElement = await page.$('#pageswitcher-content');
  if (!iframeElement) {
    console.warn("captureSheetScreenshot: pageswitcher iframe not found");
    return null;
  }

  const frame = await iframeElement.contentFrame();
  if (!frame) {
    console.warn("captureSheetScreenshot: contentFrame not accessible");
    return null;
  }

  // Execute column hiding and calculate exact active rect inside the iframe
  const clipRect = await frame.evaluate((limit) => {
    const firstRow = document.querySelector('.waffle tr, table tr');
    let hasRowHeaderShim = false;
    if (firstRow) {
      const firstCell = firstRow.children[0];
      if (firstCell && (
        firstCell.classList.contains('row-header-shim') || 
        firstCell.classList.contains('row-headers-background') ||
        firstCell.getAttribute('class')?.includes('shim')
      )) {
        hasRowHeaderShim = true;
      }
    }
    
    const colOffsetLimit = hasRowHeaderShim ? limit + 1 : limit;

    // Hide unwanted columns
    const rows = Array.from(document.querySelectorAll('.waffle tr, table tr'));
    rows.forEach(row => {
      let currentVisualCol = 0;
      const cells = Array.from(row.children);
      cells.forEach(cell => {
        const colspan = parseInt(cell.getAttribute('colspan') || '1', 10);
        if (currentVisualCol >= colOffsetLimit) {
          (cell as HTMLElement).style.display = 'none';
        } else if (currentVisualCol + colspan > colOffsetLimit) {
          cell.setAttribute('colspan', String(colOffsetLimit - currentVisualCol));
        }
        currentVisualCol += colspan;
      });
    });

    const colGroups = document.querySelectorAll('colgroup');
    colGroups.forEach(cg => {
      const cols = Array.from(cg.children);
      for (let i = colOffsetLimit; i < cols.length; i++) {
        (cols[i] as HTMLElement).style.display = 'none';
      }
    });

    // Find the last populated row index
    let lastPopulatedRow = null;
    for (let i = rows.length - 1; i >= 0; i--) {
      const cells = Array.from(rows[i].children);
      const startCheckIdx = hasRowHeaderShim ? 1 : 0;
      let hasContent = false;
      for (let j = startCheckIdx; j < cells.length; j++) {
        const cellText = (cells[j].textContent || '').trim().replace(/\u00a0/g, '');
        if (cellText !== '') {
          hasContent = true;
          break;
        }
      }
      if (hasContent) {
        lastPopulatedRow = rows[i];
        break;
      }
    }

    const table = document.querySelector('.waffle, table') as HTMLElement;
    if (!table || !lastPopulatedRow) return null;

    const tableRect = table.getBoundingClientRect();
    const lastRowRect = lastPopulatedRow.getBoundingClientRect();

    // Find the rightmost edge of any visible cell to calculate precise width
    let maxRight = tableRect.left;
    const allCells = table.querySelectorAll('td, th');
    allCells.forEach(cell => {
      const htmlCell = cell as HTMLElement;
      if (htmlCell.style.display !== 'none') {
        const rect = htmlCell.getBoundingClientRect();
        if (rect.right > maxRight && rect.width > 0) {
          maxRight = rect.right;
        }
      }
    });

    return {
      left: tableRect.left,
      top: tableRect.top,
      width: maxRight - tableRect.left,
      height: lastRowRect.bottom - tableRect.top
    };
  }, lastCol);

  if (!clipRect) {
    console.warn("captureSheetScreenshot: Failed to calculate clip rect");
    return null;
  }

  // Get iframe position on the main page
  const iframeRect = await page.evaluate(() => {
    const iframe = document.querySelector('#pageswitcher-content');
    if (!iframe) return null;
    const rect = iframe.getBoundingClientRect();
    return {
      left: rect.left,
      top: rect.top
    };
  });

  if (!iframeRect) {
    console.warn("captureSheetScreenshot: Failed to get iframe rect");
    return null;
  }

  // Calculate coordinates relative to the main viewport
  const x = iframeRect.left + clipRect.left;
  const y = iframeRect.top + clipRect.top;
  const width = Math.ceil(clipRect.width);
  const height = Math.ceil(clipRect.height);

  return await page.screenshot({
    type: 'png',
    clip: { x, y, width, height }
  }) as Buffer;
}

async function sendAllClassImages(sheets: string[]) {
  if (!constants.targetExcelLink) throw new Error("TARGET_EXCEL_LINK sozlanmagan.");
  const fileId = getFileIdFromLink(constants.targetExcelLink);
  if (!fileId) throw new Error("Excel ID topilmadi.");

  console.log("[ALL-IMAGES] Google Drive'dan Excel olinmoqda...");
  const oauth2Client = getOAuthClient();
  const tokens = await loadTokens();
  if (!tokens) throw new Error('Google hisobiga ulanmagansiz. Iltimos, avval ulaning.');
  oauth2Client.setCredentials(tokens);
  const drive = google.drive({ version: 'v3', auth: oauth2Client });

  const driveRes = await drive.files.get({ fileId, alt: 'media' }, { responseType: 'arraybuffer' });
  const rawBuffer = Buffer.from(driveRes.data as ArrayBuffer);

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(rawBuffer as any);

  let sent = 0;
  let failed = 0;
  let skipped = 0;

  console.log(`[ALL-IMAGES] Jami ${sheets.length} ta sinf yuboriladi...`);

  // Telegram Userbot-ni ulashga urinib ko'ramiz
  const userbot = await getUserbotClient();
  let isUserbotConnected = false;
  if (userbot) {
    try {
      console.log("[ALL-IMAGES] [USERBOT] Userbotga ulanilmoqda...");
      await connectUserbot(userbot);
      isUserbotConnected = true;
      console.log("[ALL-IMAGES] [USERBOT] Userbot muvaffaqiyatli ulandi.");
    } catch (err: any) {
      console.error(`[ALL-IMAGES] [USERBOT] Ulanishda xato, BOT fallback ishlatiladi: ${err.message}`);
    }
  }

  const bot = new TelegramBot(constants.telegramBotToken, { polling: false });

  console.log("[ALL-IMAGES] [Puppeteer] Launching browser to capture Google Sheets preview...");
  const browser = await puppeteer.launch({
    headless: true,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu'
    ]
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 2200, height: 1200 });
  
  const previewUrl = `https://docs.google.com/spreadsheets/d/${fileId}/preview`;
  console.log(`[ALL-IMAGES] [Puppeteer] Navigating to preview page: ${previewUrl}`);
  try {
    await page.goto(previewUrl, { waitUntil: 'networkidle2' });
    await new Promise(resolve => setTimeout(resolve, 5000));
  } catch (err: any) {
    console.error("[ALL-IMAGES] [Puppeteer] Preview sahifasiga ulanishda xato:", err.message);
    await browser.close();
    if (isUserbotConnected && userbot) {
      try { await userbot.disconnect(); } catch {}
    }
    throw err;
  }

  for (const sheetName of sheets) {
    const envKey = `TELEGRAM_CLASS_${sheetName}`;
    const classChatId = (process.env[envKey] || process.env.TELEGRAM_CHANNEL_3 || '').trim();

    if (!classChatId) {
      console.warn(`[ALL-IMAGES] ⚠️ ${sheetName}: ${envKey} va TELEGRAM_CHANNEL_3 .env da bo'sh. O'tkazib yuborildi.`);
      skipped++;
      continue;
    }

    try {
      console.log(`[ALL-IMAGES] 📸 ${sheetName} → ${envKey} (${classChatId}) ga yuborilmoqda...`);
      
      const ws = wb.getWorksheet(sheetName);
      if (!ws) {
        console.warn(`[ALL-IMAGES] ⚠️ ${sheetName} varag'i topilmadi.`);
        skipped++;
        continue;
      }

      console.log(`[ALL-IMAGES] [Puppeteer] "${sheetName}" varag'iga o'tilmoqda...`);
      
      // Get previous table HTML content to detect when the tab has loaded
      const prevHash = await page.evaluate(() => {
        const iframe = document.querySelector('#pageswitcher-content') as HTMLIFrameElement;
        const doc = iframe?.contentDocument || iframe?.contentWindow?.document;
        const table = doc?.querySelector('.waffle, table');
        return table ? table.innerHTML.slice(0, 1000) : '';
      });

      const clicked = await page.evaluate((targetName) => {
        const tabs = Array.from(document.querySelectorAll('.switcherItem, .switcherItemActive'));
        const target = tabs.find(t => t.textContent?.trim() === targetName);
        if (target) {
          (target as HTMLElement).click();
          return true;
        }
        return false;
      }, sheetName);

      if (!clicked) {
        console.warn(`[ALL-IMAGES] [Puppeteer] ⚠️ "${sheetName}" varag'i topilmadi.`);
        skipped++;
        continue;
      }

      // Wait dynamically for the iframe content to load and render the new table
      console.log(`[ALL-IMAGES] [Puppeteer] "${sheetName}" jadvali yuklanishi kutilmoqda...`);
      let loaded = false;
      for (let attempt = 0; attempt < 25; attempt++) {
        const currentData = await page.evaluate((oldHash) => {
          const iframe = document.querySelector('#pageswitcher-content') as HTMLIFrameElement;
          const doc = iframe?.contentDocument || iframe?.contentWindow?.document;
          const table = doc?.querySelector('.waffle, table');
          if (!table) return { changed: false, empty: true };
          const rows = doc.querySelectorAll('.waffle tr, table tr');
          const currentHash = table.innerHTML.slice(0, 1000);
          return {
            changed: currentHash !== oldHash,
            empty: rows.length <= 2
          };
        }, prevHash);

        if (currentData.changed && !currentData.empty) {
          loaded = true;
          break;
        }
        await new Promise(res => setTimeout(res, 250));
      }
      console.log(`[ALL-IMAGES] [Puppeteer] "${sheetName}" yuklandi (Muvaffaqiyatli: ${loaded})`);

      // Find the lastCol dynamically from the workbook
      let lastCol = 22; // default fallback
      if (ws) {
        const row2 = ws.getRow(2);
        const row3 = ws.getRow(3);
        for (let c = 1; c <= ws.columnCount; c++) {
          const val2 = String(row2.getCell(c).value || '').trim();
          const val3 = String(row3.getCell(c).value || '').trim();
          if (val2.includes('Umumiy') || val3.includes('Umumiy')) {
            lastCol = c;
            break;
          }
        }
      }

      let imgBuf: Buffer | null = null;
      try {
        imgBuf = await captureSheetScreenshot(page, lastCol);
      } catch (err: any) {
        console.warn(`[ALL-IMAGES] Precision crop screenshot failed for "${sheetName}": ${err.message}`);
      }

      if (!imgBuf) {
        const iframeEl = await page.$('#pageswitcher-content');
        if (iframeEl) {
          try {
            const frame = await iframeEl.contentFrame();
            if (frame) {
              const tableEl = await frame.$('.waffle, table');
              if (tableEl) {
                imgBuf = await tableEl.screenshot({ type: 'png' }) as Buffer;
              }
            }
          } catch (err: any) {
            console.warn(`[ALL-IMAGES] Fallback iframe table screenshot xatosi:`, err.message);
          }
          if (!imgBuf) {
            try {
              imgBuf = await iframeEl.screenshot({ type: 'png' }) as Buffer;
            } catch (e) {}
          }
        }
        if (!imgBuf) {
          imgBuf = await page.screenshot({ type: 'png' }) as Buffer;
        }
      }

      const displayName = sheetName
        .replace(/(\d+)tibg$/, '$1-Tibbiyot (yashil)')
        .replace(/(\d+)tib$/, '$1-Tibbiyot')
        .replace(/(\d+)b$/, '$1-Blue')
        .replace(/(\d+)g$/, '$1-Green')
        .replace(/^(\d+)$/, '$1-Blue');

      const caption = `Assalomu alaykum, hurmatli ota-onalar va aziz o‘quvchilar!

📌 Haftalik imtihon natijalari bilan tanishing.
Ushbu natijalarni tahlil qilishda quyidagilarga e’tibor qaratishingizni so‘raymiz:
✨ Agar natija yuqori bo‘lsa — farzandingizni albatta rag‘batlantiring va maqtang! Sizning e’tirofingiz ularning keyingi imtihonlarda yanada ishonch bilan harakat qilishiga eng kuchli turtki bo‘ladi.
Agar natija past bo‘lsa — tanqidga shoshilmang, aksincha, farzandingiz bilan birga past natijaning sabablarini tahlil qiling. Unga darslarda yanada faol bo‘lish, mavzularda tushunmagan savollarini o‘qituvchidan so‘rash va uyga berilgan topshiriqlarni to‘liq, o‘z vaqtida bajarish muvaffaqiyatning kaliti ekanligini tushuntiring. Sizning daldangiz va nazoratingiz farzandingizni ertangi g‘alabalarga yetaklovchi eng asosiy kuchdir. Sababi har bir bola mehnat, izlanish va ota-onaning qo‘llab-quvvatlashi orqali o‘z imkoniyatlarini namoyon eta oladi.

🏫 Boborahim Mashrab nomli xususiy maktab — ta’lim va intizom istaganlar uchun`;

      let sentWithUserbot = false;
      if (isUserbotConnected && userbot) {
        try {
          const { CustomFile } = await import("telegram/client/uploads.js");
          const toSend = new CustomFile(`${sheetName}.png`, imgBuf.length, "", imgBuf);
          await userbot.sendFile(classChatId, {
            file: toSend,
            caption: caption
          });
          sentWithUserbot = true;
          console.log(`[ALL-IMAGES] [USERBOT] ✅ ${sheetName} yuborildi → ${classChatId}`);
        } catch (uErr: any) {
          console.error(`[ALL-IMAGES] [USERBOT] ❌ ${sheetName} yuborishda xatolik: ${uErr.message}. Bot orqali yuborishga harakat qilinadi.`);
        }
      }

      if (!sentWithUserbot) {
        await bot.sendPhoto(classChatId, imgBuf, { caption }, { filename: `${sheetName}.png`, contentType: 'image/png' });
        console.log(`[ALL-IMAGES] [BOT] ✅ ${sheetName} yuborildi → ${classChatId}`);
      }

      sent++;
    } catch (err: any) {
      failed++;
      console.error(`[ALL-IMAGES] ❌ ${sheetName} xato: ${err.message}`);
    }
  }

  await browser.close().catch(() => {});

  if (isUserbotConnected && userbot) {
    try {
      await userbot.disconnect();
      console.log("[ALL-IMAGES] [USERBOT] Muvaffaqiyatli uzildi.");
    } catch (err: any) {
      console.error(`[ALL-IMAGES] [USERBOT] Disconnect xatosi: ${err.message}`);
    }
  }

  console.log(`[ALL-IMAGES] ✅ Yakunlandi: ${sent} yuborildi, ${failed} xato, ${skipped} o'tkazildi.`);
}

// Barcha sinflarni o'z guruhlariga yuborish API (orqa fonda, darhol javob qaytaradi)
app.post('/api/send-all-images', async (req, res) => {
  if (!constants.targetExcelLink) {
    return res.status(400).json({ error: 'TARGET_EXCEL_LINK sozlanmagan.' });
  }
  if (!constants.telegramBotToken) {
    return res.status(400).json({ error: 'TELEGRAM_BOT_TOKEN sozlanmagan.' });
  }

  // Darhol javob qaytaramiz, jarayon orqa fonda davom etadi
  res.json({ success: true, message: `${CLASS_SHEETS.length} ta sinf o'z guruhlariga yuborilmoqda. Server terminalida progress ko'ring.` });

  sendAllClassImages(CLASS_SHEETS).catch(err =>
    console.error('[ALL-IMAGES] Umumiy xato:', err.message)
  );
});


// 1-blue sinfining rasmini yuborish API (eskirgan — bir sinf uchun)
app.post('/api/send-image', async (req, res) => {
  try {
    const targetSheet = (req.body.sheetName || req.query.sheetName || '1b').trim();
    const envKey = `TELEGRAM_CLASS_${targetSheet}`;
    const classChatId = (process.env[envKey] || process.env.TELEGRAM_CHANNEL_3 || '').trim();

    console.log(`[SEND-IMAGE] targetSheet="${targetSheet}", envKey="${envKey}", classChatId="${classChatId}"`);

    if (!classChatId) {
      return res.status(400).json({ error: `TELEGRAM_CLASS_${targetSheet} yoki TELEGRAM_CHANNEL_3 .env da sozlanmagan.` });
    }

    if (!constants.targetExcelLink) throw new Error("TARGET_EXCEL_LINK sozlanmagan.");
    const fileId = getFileIdFromLink(constants.targetExcelLink);
    if (!fileId) throw new Error("Excel ID topilmadi.");

    console.log("[SEND-IMAGE] 1/3 - Google Drive'dan Excel olinmoqda...");
    const oauth2Client = getOAuthClient();
    const tokens = await loadTokens();
    if (!tokens) throw new Error('Google hisobiga ulanmagansiz. Iltimos, avval ulaning.');
    oauth2Client.setCredentials(tokens);
    const drive = google.drive({ version: 'v3', auth: oauth2Client });

    const driveRes = await drive.files.get({ fileId, alt: 'media' }, { responseType: 'arraybuffer' });
    const buffer = Buffer.from(driveRes.data as ArrayBuffer);

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as any);

    // Rasmni olishdan oldin bo'sh qatorlarni "qatnashmadi" deb o'zgartiramiz
    wb.worksheets.forEach(ws => {
      for (let i = 4; i <= ws.rowCount; i++) {
        const row = ws.getRow(i);
        let col1Val = row.getCell(1).value;
        if (col1Val && typeof col1Val === 'object' && 'result' in col1Val) col1Val = col1Val.result;
        
        const isStudentRow = col1Val !== null && col1Val !== undefined && String(col1Val).trim() !== '' && !isNaN(Number(col1Val));
        
        if (isStudentRow) {
          const subjects = [
            { cols: [4,5,6] }, { cols: [8,9,10] },
            { cols: [12,13,14] }, { cols: [16,17,18] }
          ];

          let missedAll = true;

          for (const sub of subjects) {
            let hasSubGrade = false;
            for (const c of sub.cols) {
              const val = row.getCell(c).value;
              let actualVal = val;
              if (val && typeof val === 'object' && 'result' in val) actualVal = val.result;
              if (actualVal !== null && actualVal !== undefined && String(actualVal).trim() !== '') {
                hasSubGrade = true;
                break;
              }
            }
            if (hasSubGrade) missedAll = false;
          }

          if (missedAll) {
            for (let c = 5; c <= 22; c++) {
              row.getCell(c).value = null;
            }
            try { ws.mergeCells(`D${i}:V${i}`); } catch(e) {}
            const mergedCell = row.getCell(4);
            mergedCell.value = 'qatnashmadi';
          }
        }
      }
    });

    console.log("[SEND-IMAGE] 2/3 - Puppeteer orqali rasmga olinmoqda...");
    const browser = await puppeteer.launch({
      headless: true,
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu'
      ]
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 2200, height: 1200 });
    const previewUrl = `https://docs.google.com/spreadsheets/d/${fileId}/preview`;
    await page.goto(previewUrl, { waitUntil: 'networkidle2' });
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Get previous table HTML content to detect when the tab has loaded
    const prevHash = await page.evaluate(() => {
      const iframe = document.querySelector('#pageswitcher-content') as HTMLIFrameElement;
      const doc = iframe?.contentDocument || iframe?.contentWindow?.document;
      const table = doc?.querySelector('.waffle, table');
      return table ? table.innerHTML.slice(0, 1000) : '';
    });

    const clicked = await page.evaluate((targetName) => {
      const tabs = Array.from(document.querySelectorAll('.switcherItem, .switcherItemActive'));
      const target = tabs.find(t => t.textContent?.trim() === targetName);
      if (target) {
        (target as HTMLElement).click();
        return true;
      }
      return false;
    }, targetSheet);

    if (!clicked) {
      await browser.close();
      throw new Error(`Tab "${targetSheet}" not found in preview page.`);
    }

    // Wait dynamically for the iframe content to load and render the new table
    let loaded = false;
    for (let attempt = 0; attempt < 25; attempt++) {
      const currentData = await page.evaluate((oldHash) => {
        const iframe = document.querySelector('#pageswitcher-content') as HTMLIFrameElement;
        const doc = iframe?.contentDocument || iframe?.contentWindow?.document;
        const table = doc?.querySelector('.waffle, table');
        if (!table) return { changed: false, empty: true };
        const rows = doc.querySelectorAll('.waffle tr, table tr');
        const currentHash = table.innerHTML.slice(0, 1000);
        return {
          changed: currentHash !== oldHash,
          empty: rows.length <= 2
        };
      }, prevHash);

      if (currentData.changed && !currentData.empty) {
        loaded = true;
        break;
      }
      await new Promise(res => setTimeout(res, 250));
    }

    // Find the lastCol dynamically from the workbook
    const ws = wb.getWorksheet(targetSheet);
    let lastCol = 22; // default fallback
    if (ws) {
      const row2 = ws.getRow(2);
      const row3 = ws.getRow(3);
      for (let c = 1; c <= ws.columnCount; c++) {
        const val2 = String(row2.getCell(c).value || '').trim();
        const val3 = String(row3.getCell(c).value || '').trim();
        if (val2.includes('Umumiy') || val3.includes('Umumiy')) {
          lastCol = c;
          break;
        }
      }
    }

    let imageBuffer: Buffer | null = null;
    try {
      imageBuffer = await captureSheetScreenshot(page, lastCol);
    } catch (err: any) {
      console.warn(`[SEND-IMAGE] Precision crop screenshot failed for "${targetSheet}": ${err.message}`);
    }

    if (!imageBuffer) {
      const iframeEl = await page.$('#pageswitcher-content');
      if (iframeEl) {
        try {
          const frame = await iframeEl.contentFrame();
          if (frame) {
            const tableEl = await frame.$('.waffle, table');
            if (tableEl) {
              imageBuffer = await tableEl.screenshot({ type: 'png' }) as Buffer;
            }
          }
        } catch (err: any) {
          console.warn(`[SEND-IMAGE] Fallback iframe table screenshot xatosi:`, err.message);
        }
        if (!imageBuffer) {
          try {
            imageBuffer = await iframeEl.screenshot({ type: 'png' }) as Buffer;
          } catch (e) {}
        }
      }
      if (!imageBuffer) {
        imageBuffer = await page.screenshot({ type: 'png' }) as Buffer;
      }
    }
    await browser.close();

    console.log("[SEND-IMAGE] 3/3 - Rasm Telegramga yuborilmoqda...");
    const captionText = `Assalomu alaykum, hurmatli ota-onalar va aziz o‘quvchilar!

📌 Haftalik imtihon natijalari bilan tanishing.
Ushbu natijalarni tahlil qilishda quyidagilarga e’tibor qaratishingizni so‘raymiz:
✨ Agar natija yuqori bo‘lsa — farzandingizni albatta rag‘batlantiring va maqtang! Sizning e’tirofingiz ularning keyingi imtihonlarda yanada ishonch bilan harakat qilishiga eng kuchli turtki bo‘ladi.
Agar natija past bo‘lsa — tanqidga shoshilmang, aksincha, farzandingiz bilan birga past natijaning sabablarini tahlil qiling. Unga darslarda yanada faol bo‘lish, mavzularda tushunmagan savollarini o‘qituvchidan so‘rash va uyga berilgan topshiriqlarni to‘liq, o‘z vaqtida bajarish muvaffaqiyatning kaliti ekanligini tushuntiring. Sizning daldangiz va nazoratingiz farzandingizni ertangi g‘alabalarga yetaklovchi eng asosiy kuchdir. Sababi har bir bola mehnat, izlanish va ota-onaning qo‘llab-quvvatlashi orqali o‘z imkoniyatlarini namoyon eta oladi.

🏫 Boborahim Mashrab nomli xususiy maktab — ta’lim va intizom istaganlar uchun`;

    await sendPhotoToTelegram(
      imageBuffer, 
      captionText, 
      classChatId || undefined
    );

    res.json({ success: true, message: 'Rasm muvaffaqiyatli olinib, yuborildi!' });
  } catch (error) {
    console.error("[SEND-IMAGE] Xato:", error);
    res.status(500).json({ error: String(error) });
  }
});


async function startServer() {
  if (process.env.NODE_ENV === "production") {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[API] Server running on http://localhost:${PORT}`);
  });
}

startServer();
