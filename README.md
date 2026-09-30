# LUFY X DONATE V2
ธีม Dark Purple / Neon พร้อมพื้นหลังดาวและเอฟเฟกต์ดาวตก

## แพ็กเกจ
FREE = 20 ครั้ง
PRO = 29 บาท/เดือน
PROMAX = 59 บาท/เดือน

## ฟีเจอร์
- หน้า Creator /u/username
- Donation form
- PromptPay field
- Donation history
- Donation Alert /alert/username สำหรับต่อกับ OBS
- Video Creator: YouTube / Shorts / TikTok / Vimeo
- Admin จัดการผู้ใช้และแพ็กเกจ
- พื้นหลังดาว + ดาวตก
- Responsive

## รัน
Node.js 20+
npm install
npm start
http://localhost:3000

Admin: http://localhost:3000/admin
ตัวอย่าง Creator: http://localhost:3000/u/demo

## ค่า Admin
สร้าง .env จาก .env.example และเปลี่ยน ADMIN_PASSWORD + SESSION_SECRET ก่อนเปิดสาธารณะ

## สำคัญ
ระบบโดเนทชุดนี้เป็น ledger/demo ยังไม่ยืนยันการโอนเงินจริงอัตโนมัติ และยังไม่ปลด PRO/PROMAX จากการชำระเงินเอง
หากนำขึ้นใช้งานจริง ควรเชื่อม Payment Gateway + webhook ก่อนเปิดขายแพ็กเกจ

\n## V3 additions\n- PromptPay: แนบสลิป JPG/PNG/WEBP สูงสุด 10MB\n- TrueMoney Wallet: รองรับลิงก์ซองอั่งเปา\n- PROMAX: แนบลิงก์คลิปตอนโดเนทได้แบบ optional\n- Admin เห็นช่องทางชำระเงิน สลิป และคลิป\n- การตรวจสอบสลิปยังเป็น manual; ยังไม่ได้ยืนยันเงินเข้าอัตโนมัติ\n

## V4 Member Dashboard
เพิ่มหน้า /dashboard สำหรับสมาชิก โดยมี Sidebar และหน้าตั้งค่า Widget ตามแนวภาพอ้างอิง: เสียงแจ้งเตือน/TTS, ความเร็ว, Pitch, Volume, วิดีโอ YouTube/TikTok, ระยะเวลาวิดีโอ, ตัวกรองคำหยาบ, ธีม Widget, โปรไฟล์, PromptPay, ลิงก์ซองอั่งเปา, เป้าหมายโดเนท, Quota และประวัติโดเนท


# V5 production notes
- สมาชิกใช้ username + password (password ถูก hash ด้วย Node crypto.scrypt)
- FREE จำกัด 20 รายการโดเนท; PRO/PROMAX ไม่จำกัด
- อัปเกรด PRO/PROMAX: สมาชิกแนบสลิป -> Admin อนุมัติ -> ระบบเปลี่ยนแพ็กเกจ 30 วันและรีเซ็ต quota
- PromptPay/TrueMoney สำหรับ Creator ตั้งได้จาก Dashboard
- PROMAX รองรับลิงก์คลิปตอนโดเนทแบบ optional
- สำหรับ Railway/โฮสต์ที่ filesystem ไม่ถาวร ให้ใช้ persistent volume ที่ /app/data และ /app/public/uploads หรือเปลี่ยนไปใช้ object storage/PostgreSQL ก่อนเปิดสาธารณะ
- ตั้งค่า NODE_ENV=production, ADMIN_PASSWORD และ SESSION_SECRET ใหม่ก่อน deploy
