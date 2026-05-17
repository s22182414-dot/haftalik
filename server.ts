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

import { exec } from 'child_process';
import util from 'util';

const execPromise = util.promisify(exec);
const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);

app.use(express.json());

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
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    `${process.env.APP_URL}/api/auth/google/callback`
  );
}

app.get('/api/auth/google', (req, res) => {
  const oauth2Client = getOAuthClient();
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/drive'],
    prompt: 'consent'
  });
  res.redirect(url);
});

app.get('/api/auth/google/callback', async (req, res) => {
  const { code } = req.query;
  const oauth2Client = getOAuthClient();
  try {
    const { tokens } = await oauth2Client.getToken(code as string);
    await fs.writeFile(TOKENS_PATH, JSON.stringify(tokens, null, 2));
    res.send(`
      <script>
        window.opener.postMessage('google-auth-success', '*');
        window.close();
      </script>
      <h1>Ulanmoqda...</h1>
    `);
  } catch (error) {
    res.status(500).send('Xatolik yuz berdi: ' + String(error));
  }
});// --- Database Logic ---
const DB_FILE = path.join(process.cwd(), 'database.json');

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
    await fs.access(TOKENS_PATH);
    googleConnected = true;
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
    const tokens = await fs.readFile(TOKENS_PATH, 'utf-8');
    oauth2Client.setCredentials(JSON.parse(tokens));
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
  if (message.length <= MAX_LEN) {
    await bot.sendMessage(chatId, message, {
      parse_mode: 'HTML',
      // @ts-ignore (in case older types)
      link_preview_options: { is_disabled: false },
      disable_web_page_preview: false
    });
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

// Barcha kanallar yoki faqat bitta kanalga xabar yuborish
// specificChatId berilsa — faqat shu kanalga, berilmasa — barchasiga
async function sendToTelegram(message: string, specificChatId?: string) {
  const chatIds = specificChatId ? [specificChatId] : constants.telegramChatIds;

  if (!constants.telegramBotToken || chatIds.length === 0) {
    console.warn("[Telegram] ⚠️ Token yoki Chat ID(lar) sozlanmagan! .env faylini tekshiring.");
    return;
  }

  const bot = new TelegramBot(constants.telegramBotToken, { polling: false });

  console.log(`[Telegram] 📤 ${chatIds.length} ta kanalga xabar yuborilmoqda...`);

  const results = await Promise.allSettled(
    chatIds.map(chatId => sendToSingleChat(bot, chatId, message))
  );

  let successCount = 0;
  results.forEach((result, idx) => {
    if (result.status === 'fulfilled') {
      successCount++;
      console.log(`[Telegram] ✅ Kanal ${chatIds[idx]} — yuborildi.`);
    } else {
      console.error(`[Telegram] ❌ Kanal ${chatIds[idx]} — xato: ${result.reason?.message || result.reason}`);
    }
  });

  console.log(`[Telegram] Natija: ${successCount}/${chatIds.length} ta kanalga muvaffaqiyatli yuborildi.`);

  if (successCount === 0) {
    throw new Error(`Hech qaysi kanalga xabar yuborib bo'lmadi (${chatIds.length} ta sinab ko'rildi).`);
  }
}

// Telegramga rasm yuborish
async function sendPhotoToTelegram(photoBuffer: Buffer, caption: string, specificChatId?: string) {
  const chatIds = specificChatId ? [specificChatId] : constants.telegramChatIds;

  if (!constants.telegramBotToken || chatIds.length === 0) {
    console.warn("[Telegram] ⚠️ Token yoki Chat ID(lar) sozlanmagan! .env faylini tekshiring.");
    return;
  }

  const bot = new TelegramBot(constants.telegramBotToken, { polling: false });

  console.log(`[Telegram] 📸 ${chatIds.length} ta kanalga rasm yuborilmoqda...`);

  const results = await Promise.allSettled(
    chatIds.map(async (chatId) => {
      try {
        await bot.sendPhoto(chatId, photoBuffer, { caption }, { filename: 'report.png', contentType: 'image/png' });
        console.log(`[Telegram] ✅ Kanal ${chatId} — rasm yuborildi.`);
      } catch (error: any) {
        console.error(`[Telegram] ❌ Kanal ${chatId} — rasm xatosi: ${error.message || error}`);
        if (error.message && error.message.includes('PHOTO_INVALID_DIMENSIONS')) {
          console.log(`[Telegram] 🔄 Kanal ${chatId} — Rasm o'lchami katta, hujjat (document) sifatida yuborilmoqda...`);
          await bot.sendDocument(chatId, photoBuffer, { caption }, { filename: 'report.png', contentType: 'image/png' });
          console.log(`[Telegram] ✅ Kanal ${chatId} — hujjat sifatida yuborildi.`);
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

// Juma kuni: haftalik imtihon baholarini tozalash va o'qituvchilar guruhiga xabar berish
async function runJob() {
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
      const tokens = await fs.readFile(TOKENS_PATH, 'utf-8');
      oauth2Client.setCredentials(JSON.parse(tokens));
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

    const fileMeta = await drive.files.get({ fileId, fields: 'webViewLink' });
    const fileLink = fileMeta.data.webViewLink || constants.targetExcelLink;

    console.log("[JOB] 5/5 - O'qituvchilar guruhiga (CHANNEL_1) xabar yuborilmoqda...");
    const cacheBusterUrl = fileLink + (fileLink.includes('?') ? '&' : '?') + 'v=' + Date.now();
    const messageHtml = `<a href="${cacheBusterUrl}">${fileLink}</a>`;
    await sendToTelegram(
      messageHtml,
      teachersChatId || undefined   // CHANNEL_1 (o'qituvchilar guruhi)
    );
    console.log("===== JOB MUVAFFAQIYATLI YAKUNLANDI =====");

  } catch (error) {
    const msg = (error as Error).message;
    console.error("[JOB] ❌ XATO:", msg);

    try {
      // Xatolikni ham o'qituvchilar guruhiga yuborish
      await sendToTelegram(`❌ Hisobot xatosi:\n${msg}`, teachersChatId || undefined);
    } catch (telegramErr: any) {
      console.error("[JOB] Telegram ga ham yuborib bo'lmadi:", telegramErr?.message);
    }
  }
}



// Shanba kungi AI Tahlil Job (Rahbariyat guruhi uchun)
async function analyzeJob() {
  console.log("\n===== ANALYZE JOB BOSHLANDI =====");

  // Rahbariyat guruhi — TELEGRAM_CHANNEL_2
  const managementChatId = (process.env.TELEGRAM_CHANNEL_2 || '').trim();
  try {
    if (!constants.targetExcelLink) {
      throw new Error("TARGET_EXCEL_LINK .env faylida ko'rsatilmagan.");
    }
    const fileId = getFileIdFromLink(constants.targetExcelLink);
    if (!fileId) throw new Error("Linkdan Fayl ID sini ajratib bo'lmadi.");

    console.log(`[ANALYZE] 1/4 - Drive'dan fayl olinmoqda (ID: ${fileId})...`);
    
    const oauth2Client = getOAuthClient();
    try {
      const tokens = await fs.readFile(TOKENS_PATH, 'utf-8');
      oauth2Client.setCredentials(JSON.parse(tokens));
    } catch (e) {
      throw new Error('Google hisobiga ulanmagansiz. Iltimos, avval ulaning.');
    }
    const drive = google.drive({ version: 'v3', auth: oauth2Client });

    const res = await drive.files.get({ fileId, alt: 'media' }, { responseType: 'arraybuffer' });
    const buffer = Buffer.from(res.data as ArrayBuffer) as any;

    console.log("[ANALYZE] 2/4 - Fayldan ma'lumotlar o'qilmoqda...");
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);

    const schoolData: Record<string, any[]> = {};

    workbook.worksheets.forEach(ws => {
      let percentColsInfo: { colNum: number, isOverall: boolean }[] = [];
      for (let r = 1; r <= 4; r++) {
        const headerRow = ws.getRow(r);
        headerRow.eachCell((cell, colNum) => {
          const val = String(cell.value || '').toLowerCase();
          if (val.includes('%') || val.includes('foiz')) {
             const isOverall = val.includes("umumiy") || val.includes("o'rtacha") || val.includes("o`rtacha") || val.includes("o‘rtacha");
             if (!percentColsInfo.some(p => p.colNum === colNum)) {
                 percentColsInfo.push({ colNum, isOverall });
             }
          }
        });
      }

      let percentColIndex = -1;
      let subjectPercentCols: number[] = [];
      percentColsInfo.forEach(p => {
          if (p.colNum > percentColIndex) percentColIndex = p.colNum;
          if (!p.isOverall) subjectPercentCols.push(p.colNum);
      });

      if (percentColIndex === -1) return; // Topilmasa, bu varaqni tashlab ketamiz

      const students = [];
      const rowCount = ws.rowCount;
      for (let i = 2; i <= rowCount; i++) {
        const row = ws.getRow(i);
        let col1Value = row.getCell(1).value;
        if (col1Value && typeof col1Value === 'object' && 'result' in col1Value) {
            col1Value = col1Value.result;
        }
        const isNumber = col1Value !== null && col1Value !== undefined && String(col1Value).trim() !== '' && !isNaN(Number(col1Value));

        if (isNumber) {
           const fam = String(row.getCell(2).value || '').trim();
           const ism = String(row.getCell(3).value || '').trim();
           
           let percentVal = row.getCell(percentColIndex).value;
           if (percentVal && typeof percentVal === 'object' && 'result' in percentVal) {
               percentVal = percentVal.result;
           }
           let percent = parseFloat(String(percentVal || '0'));

           // FIX: Agar Excelda Umumiy % bo'm-bo'sh bo'lsa (0 yoki NaN bo'lsa),
           // fanlardagi foizlar (subjectPercentCols) ni yig'ib o'rtachasini olamiz.
           if (!percent || percent === 0 || isNaN(percent)) {
               let sum = 0;
               let count = 0;
               for (const colNum of subjectPercentCols) {
                   if (colNum === percentColIndex) continue;
                   let val = row.getCell(colNum).value;
                   if (val && typeof val === 'object' && 'result' in val) val = val.result;
                   let p = parseFloat(String(val || '0'));
                   if (!isNaN(p) && p > 0) {
                       sum += p;
                       count++;
                   }
               }
               if (count > 0) {
                   percent = parseFloat((sum / count).toFixed(1));
               }
           }

           if (fam || ism) {
             students.push({ ism_familiya: `${fam} ${ism}`.trim(), foiz: percent });
           }
        }
      }

      if (students.length > 0) {
        schoolData[ws.name] = students;
      }
    });

    console.log(`[ANALYZE] Topilgan sinflar: ${Object.keys(schoolData).join(', ')}`);

    if (Object.keys(schoolData).length === 0) {
      throw new Error("Tahlil qilish uchun hech qanday o'quvchi ma'lumoti topilmadi. (Ehtimol '%' ustuni topilmagan)");
    }

    console.log("[ANALYZE] 3/4 - AI orqali tahlil qilinmoqda...");
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

    const prompt = `Har bir sinf uchun faqatgina quyidagilarni yozing:
- Sinf nomi (Agar barcha o'quvchilarning natijasi 0% bo'lsa, faqatgina "Baholar kiritilmagan" deb yozing va o'quvchilarni chiqarmang).
- 🥇 1-chi o'rinni olgan o'quvchilar (Agar bir xil eng yuqori natija bo'lsa, barchasini 1-o'rin sifatida yozing. 0% bo'lsa yozmang).
- 2-chi o'rinni olgan o'quvchilar.
- ‼️ 50% dan past olgan o'quvchilar (0% dan katta, lekin 50% dan kichik bo'lganlar. Natijasi 0% bo'lganlarni umuman ro'yxatga qo'shmang!).


Hech qanday ortiqcha so'zlar, salomlashish yoki uzun gaplar yozmang. Faqat qisqa ro'yxat bo'lsin.

Ma'lumotlar:
${JSON.stringify(schoolData, null, 2)}`;


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
      managementChatId || undefined // CHANNEL_2 (rahbariyat guruhi)
    );


    console.log("===== ANALYZE JOB MUVAFFAQIYATLI YAKUNLANDI =====");
  } catch (error) {
    const msg = (error as Error).message;
    console.error("[ANALYZE] ❌ XATO:", msg);
    try {
      await sendToTelegram(`❌ Tahlil xatosi:\n${msg}`, managementChatId || undefined);
    } catch (e) {}
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
        <div class="bg-gradient-to-r ${theme.primary} text-white text-center py-6 px-8 rounded-2xl mb-6 shadow-md">
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
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--font-render-hinting=none']
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

async function sendAllClassImages(sheets: string[]) {
  if (!constants.targetExcelLink) throw new Error("TARGET_EXCEL_LINK sozlanmagan.");
  const fileId = getFileIdFromLink(constants.targetExcelLink);
  if (!fileId) throw new Error("Excel ID topilmadi.");

  const bot = new TelegramBot(constants.telegramBotToken, { polling: false });

  console.log("[ALL-IMAGES] Google Drive'dan Excel olinmoqda...");
  const oauth2Client = getOAuthClient();
  const tokens = await fs.readFile(TOKENS_PATH, 'utf-8');
  oauth2Client.setCredentials(JSON.parse(tokens));
  const drive = google.drive({ version: 'v3', auth: oauth2Client });

  const driveRes = await drive.files.get({ fileId, alt: 'media' }, { responseType: 'arraybuffer' });
  const rawBuffer = Buffer.from(driveRes.data as ArrayBuffer);

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(rawBuffer as any);

  let sent = 0;
  let failed = 0;
  let skipped = 0;

  console.log(`[ALL-IMAGES] Jami ${sheets.length} ta sinf yuboriladi...`);

  for (const sheetName of sheets) {
    const envKey = `TELEGRAM_CLASS_${sheetName}`;
    const classChatId = (process.env[envKey] || '').trim();

    if (!classChatId) {
      console.warn(`[ALL-IMAGES] ⚠️ ${sheetName}: ${envKey} .env da bo'sh. O'tkazib yuborildi.`);
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

      const htmlContent = generateSheetHtml(ws, sheetName);
      const imgBuf = await captureHtmlAsImage(htmlContent);

      const displayName = sheetName
        .replace(/(\d+)tibg$/, '$1-Tibbiyot (yashil)')
        .replace(/(\d+)tib$/, '$1-Tibbiyot')
        .replace(/(\d+)b$/, '$1-Blue')
        .replace(/(\d+)g$/, '$1-Green')
        .replace(/^(\d+)$/, '$1-Blue');

      const caption = `Assalomu alaykum, hurmatli ota-onalar va aziz o'quvchilar!\n\n📊 ${displayName} sinfi — Haftalik imtihon natijalari\n\n✨ Agar natija yuqori bo'lsa — farzandingizni rag'batlantiring!\nAgar natija past bo'lsa — birga tahlil qiling va qo'llab-quvvatlang.\n\n🏫 Boborahim Mashrab nomli xususiy maktab`;

      await bot.sendPhoto(classChatId, imgBuf, { caption }, { filename: `${sheetName}.png`, contentType: 'image/png' });
      sent++;
      console.log(`[ALL-IMAGES] ✅ ${sheetName} (${sent}/${sheets.length - skipped}) yuborildi → ${classChatId}`);
    } catch (err: any) {
      failed++;
      console.error(`[ALL-IMAGES] ❌ ${sheetName} xato: ${err.message}`);
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
    const targetSheet = '1b';
    const channel3 = (process.env.TELEGRAM_CHANNEL_3 || '').trim();

    if (!constants.targetExcelLink) throw new Error("TARGET_EXCEL_LINK sozlanmagan.");
    const fileId = getFileIdFromLink(constants.targetExcelLink);
    if (!fileId) throw new Error("Excel ID topilmadi.");

    console.log("[SEND-IMAGE] 1/3 - Google Drive'dan Excel olinmoqda...");
    const oauth2Client = getOAuthClient();
    const tokens = await fs.readFile(TOKENS_PATH, 'utf-8');
    oauth2Client.setCredentials(JSON.parse(tokens));
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
    const ws = wb.getWorksheet(targetSheet);
    if (!ws) throw new Error(`Worksheet not found: ${targetSheet}`);

    const htmlContent = generateSheetHtml(ws, targetSheet);
    const imageBuffer = await captureHtmlAsImage(htmlContent);

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
      channel3 || undefined
    );

    res.json({ success: true, message: 'Rasm muvaffaqiyatli olinib, yuborildi!' });
  } catch (error) {
    console.error("[SEND-IMAGE] Xato:", error);
    res.status(500).json({ error: String(error) });
  }
});


async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
