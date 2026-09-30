# LUFY X DONATE V6 — Production-oriented Creator Donation Platform

V6 ปรับจากภาพอ้างอิงของ Dashboard ที่ให้มา โดยเอา Demo ออกจากหน้าเว็บหลัก และเพิ่มระบบบัญชี/เครดิต/เติมเงิน/ยืนยัน Gmail

## สิ่งที่มีใน V6
- หน้า Home LUFY X DONATE ธีม Dark Purple / Neon + ดาว
- ไม่มีลิงก์ Demo และไม่มีเมนู "สมาชิก" บนหน้า Home
- สมัครสมาชิกด้วย Gmail + ยืนยันอีเมลก่อน Login
- Login / Logout / Session
- ลืมรหัสผ่าน + reset ผ่านอีเมล
- Dashboard Sidebar ตามเมนู Creator
- PromptPay / TrueMoney สำหรับหน้า Creator
- Donation Alert + TTS + ตั้งเสียง/ความเร็ว/โทน/กรองคำหยาบ
- PROMAX รับลิงก์ YouTube/TikTok/Vimeo ตอนโดเนทได้แบบ optional
- FREE 20 ครั้ง / PRO 29 บาท / PROMAX 59 บาท ต่อ 30 วัน
- ระบบเครดิต: ค่าเริ่มต้น 1 บาท = 1 เครดิต
- เติมเครดิตด้วย PromptPay / TrueMoney ซองอั่งเปา / โอนบัญชีธนาคาร
- แนบสลิป JPG/PNG/WEBP สูงสุด 10 MB
- Admin ตรวจสลิป -> อนุมัติ -> เครดิตเข้าบัญชี
- ซื้อ PRO/PROMAX ด้วยเครดิต
- Credit transaction ledger และประวัติเติมเงิน
- Admin ดูสมาชิก / เติมเครดิต / รายการโดเนท
- OBS Browser Source: `/alert/USERNAME`
- Creator page: `/u/USERNAME`

## รันในเครื่อง
Node.js 20+

```bash
npm install
npm start
```

เปิด `http://localhost:3000`

## Gmail verification
แนะนำใช้ Gmail + Google App Password (ไม่ใช่รหัสผ่าน Gmail หลัก) แล้วตั้งค่าใน `.env`:

```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=yourgmail@gmail.com
SMTP_PASS=YOUR_GMAIL_APP_PASSWORD
MAIL_FROM=LUFY X DONATE <yourgmail@gmail.com>
```

ถ้า SMTP ยังไม่ตั้งค่า ระบบจะไม่ส่งเมลจริง และจะพิมพ์ลิงก์ยืนยันลง Server log สำหรับทดสอบเท่านั้น

## ช่องทางเติมเครดิตของเว็บ
ตั้งค่าใน `.env`:

```env
PROMPTPAY_ID=0812345678
TRUEWALLET_LINK=https://gift.truemoney.com/campaign/?v=YOUR_ENVELOPE
BANK_NAME=ชื่อธนาคาร
BANK_ACCOUNT_NAME=ชื่อเจ้าของบัญชี
BANK_ACCOUNT_NO=1234567890
CREDIT_PER_BAHT=1
```

หลักการคือสมาชิกโอนเงินจริง -> แนบสลิป -> Admin ตรวจ -> อนุมัติ -> เครดิตเข้าบัญชี

> ระบบนี้ไม่ได้แอบอ้างว่า "ตรวจเงินเข้าอัตโนมัติ" จากสลิป การอนุมัติ V6 เป็น manual โดย Admin ซึ่งปลอดภัยกว่าการให้ระบบเชื่อสลิปจากรูปเพียงอย่างเดียว

## Production / Railway
ถ้าจะเปิดใช้งานจริง ควรมี Persistent Volume สำหรับ `/app/data` เพราะ V6 ใช้ SQLite + เก็บสลิปใน data/uploads

ถ้าจะรองรับผู้ใช้จำนวนมาก แนะนำย้ายฐานข้อมูลจาก SQLite ไป PostgreSQL และย้ายไฟล์สลิปไป Object Storage (S3/R2/Cloudinary ฯลฯ)

ต้องเปลี่ยนอย่างน้อย:

```env
NODE_ENV=production
PUBLIC_URL=https://โดเมนของคุณ
ADMIN_PASSWORD=รหัสยาวและสุ่มใหม่
SESSION_SECRET=ค่าสุ่มยาวมาก
```

## Admin
- URL: `/admin`
- ค่าเริ่มต้นจาก `.env`: `ADMIN_USER` / `ADMIN_PASSWORD`
- ใช้สำหรับตรวจสลิปเติมเครดิตและรายการโดเนท

## หมายเหตุการอัปเกรดจาก V5
V6 เปลี่ยนโครงสร้างสมาชิกโดยเพิ่ม Gmail verification และ credit wallet อย่างมีนัยสำคัญ หากฐานข้อมูล V5 มีข้อมูลจริง ให้สำรอง `/app/data` ก่อนอัปเกรด และทดสอบ migration บนสำเนาก่อนเปิดใช้งานจริง


## V6.1 Payment behavior
- Email verification has been removed. Registration can proceed without clicking an email link.
- Member top-up via TrueMoney uses `TRUEWALLET_OWNER_PHONE` as the owner receiving number.
- Creator donation via TrueMoney uses each creator's `truewallet_phone` configured in Dashboard > ช่องทางรับเงิน.
- PromptPay/bank top-ups still use slip review by Admin.
- The site does not directly move TrueMoney funds by itself. Without an official TrueMoney merchant/API integration, the browser can only show/copy the recipient phone or open a configured link; the actual transfer must be completed in TrueMoney.
