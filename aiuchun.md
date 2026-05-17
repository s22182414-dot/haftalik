# Avto Hisobot AI - Loyiha Arxitekturasi va Qo'llanmasi (AI uchun)

Ushbu fayl kelajakdagi AI yordamchilari loyiha kontekstini, strukturasini va shu paytgacha qilingan ishlarni tezroq tushunib olishi uchun maxsus yaratilgan. Loyiha maktab yoki o'quv markazlari (xususan "Boborahim Mashrab" xususiy maktabi) uchun baholash, AI tahlil va haftalik hisobotlarni to'liq avtomatlashtirishga qaratilgan.

## 🛠 Texnologiyalar Steki
- **Frontend:** React (TypeScript), Vite, Tailwind CSS v4, React Router DOM, Lucide React
- **Backend:** Node.js, Express.js, TypeScript (monolitik `server.ts`)
- **Ma'lumotlar bazasi:** Mahalliy JSON fayl (`database.json`) va brauzer `localStorage`
- **Tashqi API va Xizmatlar:** 
  - Google Generative AI (Gemini modellar oilasi)
  - Google Drive API (OAuth 2.0 orqali)
  - Telegram Bot API (node-telegram-bot-api)
- **Avtomatlashtirish:** node-cron (Haftalik vazifalar uchun)
- **Kutubxonalar:** `exceljs` (Excel fayllarni tahrirlash)

---

## 🚀 Asosiy Modullar va Avtomatik Vazifalar (Cron Jobs)

Loyihaning eng asosiy mantiqi `server.ts` faylida jamlangan. U avtomatlashtirilgan jarayonlarni boshqaradi:

### 1. Juma kungi Tozalash Vazifasi (`runJob` — Juma 17:00)
- **Maqsad:** `.env` faylidagi `TARGET_EXCEL_LINK` havolasidan Google Drive'dagi haftalik Excel faylini yuklab olib, eski baholarni tozalash (yangi hafta uchun).
- **Qanday ishlaydi:** Dastur barcha varaqlarni o'qiydi, o'quvchilar ro'yxati (1-ustun raqamligiga qarab) aniqlanadi. 4-ustundan boshlab **formula bo'lmagan** barcha baho hujayralari tozalanadi.
- **Natija:** Tozalangan shablon Drive'ga qayta yuklanadi va `TELEGRAM_CHANNEL_1` (O'qituvchilar guruhi) ga tayyor ekanligi haqida xabar ketadi.

### 2. Shanba kungi AI Tahlil Vazifasi (`analyzeJob` — Shanba 18:00)
- **Maqsad:** O'qituvchilar kiritgan baholarni tahlil qilish va natijalarni e'lon qilish.
- **AI Tahlil qismi:** Excel o'qiladi, o'quvchilar va ularning umumiy foizlari (yoki fanlar bo'yicha o'rtacha foizlari) yig'iladi. Ma'lumot qisqartirilib **Gemini AI** ga beriladi. AI qisqa qilib (1-o'rin, 2-o'rin va qoloqlar) ro'yxat tuzadi. Bu xabar `TELEGRAM_CHANNEL_2` (Rahbariyat guruhi) ga yuboriladi.

### 3. Ota-onalar Uchun Rasm Hisobot (Qo'lda boshqariladigan `POST /api/send-image`)
- **Maqsad:** Reports sahifasidan tugma orqali ishga tushadi. Excel jadvalidagi natijalarni vizual rasm ko'rinishida yuborish.
- **Qanday ishlaydi:** Tizim Windows COM ob'ektidan (PowerShell skripti) foydalanib jadvalni rasmga oladi va uni `TELEGRAM_CHANNEL_3` (Ota-onalar guruhi) ga chiroyli motivatsion xabar bilan yuboradi.

---

## 🔐 Arxitektura Yechimlari

1. **Telegram Multi-Channel Tizimi:** Dastur `.env` faylida ko'rsatilgan bir necha kanallarga (`TELEGRAM_CHANNEL_1`, `TELEGRAM_CHANNEL_2`, `TELEGRAM_CHANNEL_3`) har xil ma'lumotlarni saralab yuboradi. Shuningdek, xabar hajmi uzun bo'lsa (4096 belgidan), uni xavfsiz chunking (bo'laklash) qilib yuboradi.
2. **AI Fallback Mexanizmi:** Ba'zan Google Gemini API chegaralari tugashi yoki 403 Forbidden xatosi kelishi mumkin. Buning uchun `server.ts` da bir necha xil Gemini modellari (`AI_MODELS`) ro'yxati tuzilgan. Tizim eng kuchlisidan boshlab navbat bilan sinab ko'radi. Agar biri ishlamasa, keyingisiga avtomat ravishda o'tib ketadi.
3. **ExcelJS Shared Formula:** Jadval Drive'dan o'qilganda "Shared Formula" larni tahrirlash paytida buzilib ketish xatosi aniqlangan. Shuning uchun faylni tozalashda oldin Shared Formulalar oddiy formulalarga o'giriladi.

## ⚠️ Eslatmalar va Tozalashlar
- **Foydalanilmayotgan fayllar:** Dastlabki yozilgan ba'zi frontend UI modullari (`Grades.tsx`, `Teachers.tsx`, `html2canvas`, `jspdf`) amalda ishlatilmaydi. Loyiha hozirda asosan hisobotlarni generatsiya qilish va yuborishga qaratilgan.
- **`database.json` vs `localStorage`:** O'quvchilar JSON bazada saqlanadi, biroq sinflar tartibi frontendda `localStorage` da turadi. API larni o'zgartirganda shuni yodda tutish kerak.
