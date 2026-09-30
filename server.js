require('dotenv').config();
const express=require('express');
const helmet=require('helmet');
const cookieParser=require('cookie-parser');
const multer=require('multer');
const Database=require('better-sqlite3');
const crypto=require('crypto');
const path=require('path');
const fs=require('fs');
const nodemailer=require('nodemailer');
const QRCode=require('qrcode');

const app=express();
const PORT=Number(process.env.PORT||3000);
const DATA=path.join(__dirname,'data');
const UPLOADS=path.join(DATA,'uploads');
fs.mkdirSync(UPLOADS,{recursive:true});

const db=new Database(path.join(DATA,'lufy-x-donate.db'));
db.pragma('journal_mode=WAL');
db.pragma('foreign_keys=ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 username TEXT UNIQUE NOT NULL,
 email TEXT UNIQUE NOT NULL,
 email_verified_at TEXT DEFAULT '',
 verify_token_hash TEXT DEFAULT '',
 verify_expires_at TEXT DEFAULT '',
 reset_token_hash TEXT DEFAULT '',
 reset_expires_at TEXT DEFAULT '',
 plan TEXT NOT NULL DEFAULT 'FREE',
 plan_expires_at TEXT DEFAULT '',
 credits REAL NOT NULL DEFAULT 0,
 usage_count INTEGER NOT NULL DEFAULT 0,
 display_name TEXT DEFAULT '', bio TEXT DEFAULT '',
 promptpay TEXT DEFAULT '', truewallet_link TEXT DEFAULT '', truewallet_phone TEXT DEFAULT '',
 widget_settings TEXT DEFAULT '{}', password_hash TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 last_login_at TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS donations(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 creator TEXT NOT NULL, donor TEXT DEFAULT '', amount REAL NOT NULL,
 message TEXT DEFAULT '', status TEXT DEFAULT 'PENDING',
 payment_method TEXT DEFAULT 'PROMPTPAY', slip_url TEXT DEFAULT '',
 wallet_link TEXT DEFAULT '', video_url TEXT DEFAULT '',
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 reviewed_at TEXT DEFAULT '', reviewed_by TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS topups(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 username TEXT NOT NULL, amount REAL NOT NULL,
 method TEXT NOT NULL, slip_file TEXT DEFAULT '',
 note TEXT DEFAULT '', status TEXT NOT NULL DEFAULT 'PENDING',
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 reviewed_at TEXT DEFAULT '', reviewed_by TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS credit_transactions(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 username TEXT NOT NULL, amount REAL NOT NULL,
 balance_after REAL NOT NULL, type TEXT NOT NULL,
 reference TEXT DEFAULT '', note TEXT DEFAULT '',
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS videos(
 id INTEGER PRIMARY KEY AUTOINCREMENT, creator TEXT NOT NULL,
 title TEXT NOT NULL, url TEXT NOT NULL, embed_url TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_donations_creator ON donations(creator,id DESC);
CREATE INDEX IF NOT EXISTS idx_topups_user ON topups(username,id DESC);
CREATE INDEX IF NOT EXISTS idx_credit_user ON credit_transactions(username,id DESC);
`);

// Safe migrations from the older V5 database.
const migrations=[
 ['users','email','ALTER TABLE users ADD COLUMN email TEXT DEFAULT \'\''],
 ['users','email_verified_at','ALTER TABLE users ADD COLUMN email_verified_at TEXT DEFAULT \'\''],
 ['users','verify_token_hash','ALTER TABLE users ADD COLUMN verify_token_hash TEXT DEFAULT \'\''],
 ['users','verify_expires_at','ALTER TABLE users ADD COLUMN verify_expires_at TEXT DEFAULT \'\''],
 ['users','reset_token_hash','ALTER TABLE users ADD COLUMN reset_token_hash TEXT DEFAULT \'\''],
 ['users','reset_expires_at','ALTER TABLE users ADD COLUMN reset_expires_at TEXT DEFAULT \'\''],
 ['users','credits','ALTER TABLE users ADD COLUMN credits REAL DEFAULT 0'],
 ['users','plan_expires_at','ALTER TABLE users ADD COLUMN plan_expires_at TEXT DEFAULT \'\''],
 ['users','last_login_at',"ALTER TABLE users ADD COLUMN last_login_at TEXT DEFAULT ''"],
 ['users','truewallet_phone',"ALTER TABLE users ADD COLUMN truewallet_phone TEXT DEFAULT ''"],
 ['users','password_hash',"ALTER TABLE users ADD COLUMN password_hash TEXT DEFAULT ''"]
];
for(const [, ,sql] of migrations){try{db.exec(sql)}catch{} }

const SITE=process.env.SITE_NAME||'LUFY X DONATE';
const ADMIN=process.env.ADMIN_USER||'admin';
const ADMIN_PASSWORD=process.env.ADMIN_PASSWORD||'CHANGE_ME';
const SECRET=process.env.SESSION_SECRET||'CHANGE_ME_LONG_SECRET';
const CREDIT_RATE=Math.max(0.01,Number(process.env.CREDIT_PER_BAHT||1));
const PLANS={FREE:{price:0,limit:20},PRO:{price:29,limit:null},PROMAX:{price:59,limit:null}};

const upload=multer({
 storage:multer.diskStorage({destination:(req,file,cb)=>cb(null,UPLOADS),filename:(req,file,cb)=>cb(null,Date.now()+'-'+crypto.randomBytes(8).toString('hex')+path.extname(file.originalname).toLowerCase())}),
 limits:{fileSize:10*1024*1024},
 fileFilter:(req,file,cb)=>cb(['image/jpeg','image/png','image/webp'].includes(file.mimetype)?null:new Error('รองรับ JPG, PNG, WEBP เท่านั้น'))
});

app.use(helmet({contentSecurityPolicy:false,crossOriginEmbedderPolicy:false}));
app.use(express.json({limit:'400kb'}));
app.use(cookieParser());
app.use(express.static(path.join(__dirname,'public')));

function safe(v,n=300){return String(v??'').trim().slice(0,n)}
function validEmail(v){return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v||''))}
function validPassword(v){return typeof v==='string'&&v.length>=8&&v.length<=128}
function hashPassword(p){const salt=crypto.randomBytes(16).toString('hex');return salt+':'+crypto.scryptSync(p,salt,64).toString('hex')}
function verifyPassword(p,stored){try{const [salt,h]=String(stored||'').split(':');const got=crypto.scryptSync(p,salt,64);return !!salt&&!!h&&crypto.timingSafeEqual(got,Buffer.from(h,'hex'))}catch{return false}}
function hashToken(t){return crypto.createHash('sha256').update(t).digest('hex')}
function sig(v){return crypto.createHmac('sha256',SECRET).update(v).digest('hex')}
function makeSession(u){const p=Buffer.from(JSON.stringify({u,t:Date.now()})).toString('base64url');return p+'.'+sig(p)}
function getSession(req){try{const [p,s]=String(req.cookies.lufy_session||'').split('.');if(!p||s!==sig(p))return null;const x=JSON.parse(Buffer.from(p,'base64url').toString());return Date.now()-x.t<7*864e5?x.u:null}catch{return null}}
function auth(req,res,next){const u=getSession(req);if(!u)return res.status(401).json({error:'กรุณาเข้าสู่ระบบ'});req.user=u;next()}
function admin(req,res,next){if(req.cookies.lufy_admin===sig('admin:'+ADMIN))return next();res.status(401).json({error:'ไม่มีสิทธิ์'})}
function effectivePlan(row){if(!row)return 'FREE';if(row.plan!=='FREE'&&row.plan_expires_at&&Date.parse(row.plan_expires_at)<=Date.now())return 'FREE';return PLANS[row.plan]?row.plan:'FREE'}
function limitFor(row){const p=effectivePlan(row);return PLANS[p].limit}
function makeToken(){return crypto.randomBytes(32).toString('hex')}
function siteUrl(){return (process.env.PUBLIC_URL||'').replace(/\/$/,'')||`http://localhost:${PORT}`}

let mailer=null;
if(process.env.SMTP_HOST&&process.env.SMTP_USER&&process.env.SMTP_PASS){
 mailer=nodemailer.createTransport({host:process.env.SMTP_HOST,port:Number(process.env.SMTP_PORT||587),secure:String(process.env.SMTP_SECURE||'false')==='true',auth:{user:process.env.SMTP_USER,pass:process.env.SMTP_PASS}});
}
async function sendMail(to,subject,html){
 if(!mailer){console.log('[EMAIL NOT CONFIGURED]',to,subject,html);return false}
 await mailer.sendMail({from:process.env.MAIL_FROM||process.env.SMTP_USER,to,subject,html});return true;
}
async function sendResetEmail(email,token){const link=siteUrl()+'/reset-password?token='+encodeURIComponent(token);return sendMail(email,'รีเซ็ตรหัสผ่าน — LUFY X DONATE',`<div style="font-family:Arial"><h2>รีเซ็ตรหัสผ่าน</h2><p><a href="${link}">ตั้งรหัสผ่านใหม่</a></p><p>ลิงก์หมดอายุภายใน 1 ชั่วโมง</p></div>`)}

function promptpayId(){return safe(process.env.PROMPTPAY_ID,80)}
function paymentConfig(){return {promptpayId:promptpayId(),truewalletLink:safe(process.env.TRUEWALLET_LINK,500),truewalletOwnerPhone:safe(process.env.TRUEWALLET_OWNER_PHONE,30),bankName:safe(process.env.BANK_NAME,120),bankAccountName:safe(process.env.BANK_ACCOUNT_NAME,120),bankAccountNo:safe(process.env.BANK_ACCOUNT_NO,80),creditRate:CREDIT_RATE}}

app.get('/api/config',(req,res)=>res.json({siteName:SITE,plans:PLANS,publicUrl:siteUrl()}));
app.get('/api/payment-config',async(req,res)=>{const c=paymentConfig();let promptpayQr='';if(c.promptpayId){try{promptpayQr=await QRCode.toDataURL('PromptPay: '+c.promptpayId,{width:260,margin:2})}catch{}}res.json({...c,promptpayQr})});

app.post('/api/register',async(req,res)=>{
 const u=safe(req.body.username,24).toLowerCase(), email=safe(req.body.email,160).toLowerCase(), p=String(req.body.password||'');
 if(!/^[a-z0-9_]{3,24}$/.test(u))return res.status(400).json({error:'Username 3-24 ตัว ใช้ a-z 0-9 _'});
 if(email && !validEmail(email))return res.status(400).json({error:'รูปแบบอีเมลไม่ถูกต้อง'});
 if(!validPassword(p))return res.status(400).json({error:'รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร'});
 try{
  db.prepare(`INSERT INTO users(username,email,email_verified_at,display_name,password_hash) VALUES(?,?,?,?,?)`).run(u,email,'',u,hashPassword(p));
  res.json({ok:true,verificationRequired:false});
 }catch(e){if(String(e.message).includes('UNIQUE'))return res.status(409).json({error:'Username หรืออีเมลนี้ถูกใช้งานแล้ว'});return res.status(500).json({error:'สมัครสมาชิกไม่สำเร็จ'})}
});

app.post('/api/login',(req,res)=>{const u=safe(req.body.username,24).toLowerCase(),p=String(req.body.password||''),x=db.prepare('SELECT * FROM users WHERE username=?').get(u);if(!x||!verifyPassword(p,x.password_hash))return res.status(401).json({error:'Username หรือรหัสผ่านไม่ถูกต้อง'});db.prepare('UPDATE users SET last_login_at=CURRENT_TIMESTAMP WHERE username=?').run(u);res.cookie('lufy_session',makeSession(u),{httpOnly:true,sameSite:'lax',secure:process.env.NODE_ENV==='production',maxAge:7*864e5});res.json({ok:true})});
app.post('/api/logout',(req,res)=>{res.clearCookie('lufy_session');res.json({ok:true})});

app.get('/api/me',(req,res)=>{const u=getSession(req);if(!u)return res.json({loggedIn:false});const x=db.prepare('SELECT username,email,email_verified_at,plan,plan_expires_at,credits,usage_count,display_name,bio,promptpay,truewallet_link,truewallet_phone,widget_settings,created_at FROM users WHERE username=?').get(u);if(!x)return res.json({loggedIn:false});let settings={};try{settings=JSON.parse(x.widget_settings||'{}')}catch{}const p=effectivePlan(x),lim=PLANS[p].limit;res.json({loggedIn:true,...x,plan:p,widget_settings:settings,limit:lim,remaining:lim===null?null:Math.max(0,lim-x.usage_count)});});
app.put('/api/profile',auth,(req,res)=>{db.prepare('UPDATE users SET display_name=?,bio=?,promptpay=?,truewallet_link=?,truewallet_phone=? WHERE username=?').run(safe(req.body.display_name,80),safe(req.body.bio,300),safe(req.body.promptpay,80),safe(req.body.truewallet_link,500),safe(req.body.truewallet_phone,30),req.user);res.json({ok:true})});
app.put('/api/widget-settings',auth,(req,res)=>{const x=db.prepare('SELECT widget_settings FROM users WHERE username=?').get(req.user);let cur={};try{cur=JSON.parse(x?.widget_settings||'{}')}catch{};const allow=['theme','show_name_amount','show_message','tts','tts_voice','speed','pitch','alert_volume','video_enabled','video_max','video_volume','keyword_filter','goal','top_donors','recent','countdown'];for(const k of allow)if(k in (req.body||{}))cur[k]=req.body[k];db.prepare('UPDATE users SET widget_settings=? WHERE username=?').run(JSON.stringify(cur),req.user);res.json({ok:true,settings:cur})});

app.get('/api/dashboard/stats',auth,(req,res)=>{const total=db.prepare("SELECT COALESCE(SUM(amount),0) total FROM donations WHERE creator=? AND status!='REJECTED'").get(req.user).total;const count=db.prepare("SELECT COUNT(*) count FROM donations WHERE creator=? AND status!='REJECTED'").get(req.user).count;const recent=db.prepare('SELECT donor,amount,message,created_at,status FROM donations WHERE creator=? ORDER BY id DESC LIMIT 8').all(req.user);res.json({total,count,recent})});
app.get('/api/donations/:u',(req,res)=>res.json(db.prepare('SELECT id,donor,amount,message,status,created_at,video_url,payment_method FROM donations WHERE creator=? ORDER BY id DESC LIMIT 200').all(safe(req.params.u,24).toLowerCase())));
app.get('/api/videos/:u',(req,res)=>res.json(db.prepare('SELECT * FROM videos WHERE creator=? ORDER BY id DESC').all(safe(req.params.u,24).toLowerCase())));

function yt(url){try{const u=new URL(url);let id='';if(u.hostname==='youtu.be')id=u.pathname.slice(1);else if(u.hostname.includes('youtube.com')){if(u.pathname==='/watch')id=u.searchParams.get('v')||'';else if(u.pathname.startsWith('/shorts/'))id=u.pathname.split('/')[2]||'';else if(u.pathname.startsWith('/embed/'))id=u.pathname.split('/')[2]||''}return /^[\w-]{6,20}$/.test(id)?'https://www.youtube.com/embed/'+id:null}catch{return null}}
function embed(url){const y=yt(url);if(y)return y;try{const u=new URL(url),h=u.hostname.toLowerCase();return ['tiktok.com','vimeo.com'].some(x=>h===x||h.endsWith('.'+x))?url:null}catch{return null}}

app.get('/api/creator/:u',(req,res)=>{const x=db.prepare('SELECT username,plan,display_name,bio,promptpay,truewallet_link,truewallet_phone,widget_settings FROM users WHERE username=?').get(safe(req.params.u,24).toLowerCase());if(!x)return res.status(404).json({error:'ไม่พบหน้า Creator'});let p=effectivePlan(x),settings={};try{settings=JSON.parse(x.widget_settings||'{}')}catch{};res.json({...x,plan:p,widget_settings:settings})});

app.post('/api/donate/:u',upload.single('slip'),(req,res)=>{
 const c=safe(req.params.u,24).toLowerCase(),x=db.prepare('SELECT * FROM users WHERE username=?').get(c);if(!x)return res.status(404).json({error:'ไม่พบหน้า Creator'});
 const amount=Number(req.body.amount);if(!Number.isFinite(amount)||amount<1||amount>1e7)return res.status(400).json({error:'จำนวนเงินไม่ถูกต้อง'});
 const p=effectivePlan(x),lim=PLANS[p].limit;if(lim!==null&&x.usage_count>=lim)return res.status(429).json({error:'Creator ใช้ครบ 20 รายการแล้ว'});
 const method=['PROMPTPAY','TRUEWALLET'].includes(req.body.payment_method)?req.body.payment_method:'PROMPTPAY';
 if(method==='PROMPTPAY'&&!req.file)return res.status(400).json({error:'กรุณาแนบสลิป PromptPay'});
 if(method==='TRUEWALLET'&&!x.truewallet_phone)return res.status(400).json({error:'Creator ยังไม่ได้ตั้งค่าเบอร์ TrueMoney Wallet'});
 let settings={};try{settings=JSON.parse(x.widget_settings||'{}')}catch{};
 let message=safe(req.body.message,300);if(settings.keyword_filter!==false)message=message.replace(/(?:เหี้ย|สัส|ควย|เย็ด|แม่ง)/gi,'***');
 let video=safe(req.body.video_url,500);if(p!=='PROMAX'||settings.video_enabled===false)video='';if(video&&!/^https?:\/\//i.test(video))return res.status(400).json({error:'ลิงก์คลิปไม่ถูกต้อง'});
 const slip=req.file?req.file.filename:'';
 const id=db.transaction(()=>{const r=db.prepare('INSERT INTO donations(creator,donor,amount,message,payment_method,slip_url,wallet_link,video_url) VALUES(?,?,?,?,?,?,?,?)').run(c,safe(req.body.donor,60),amount,message,method,slip,x.truewallet_phone||'',video);db.prepare('UPDATE users SET usage_count=usage_count+1 WHERE username=?').run(c);return r.lastInsertRowid})();
 res.json({ok:true,id});
});

// Member wallet / credit top-up.
app.get('/api/wallet',auth,(req,res)=>{const u=db.prepare('SELECT credits FROM users WHERE username=?').get(req.user);const tx=db.prepare('SELECT amount,balance_after,type,reference,note,created_at FROM credit_transactions WHERE username=? ORDER BY id DESC LIMIT 100').all(req.user);const tops=db.prepare('SELECT id,amount,method,status,created_at,reviewed_at FROM topups WHERE username=? ORDER BY id DESC LIMIT 30').all(req.user);res.json({credits:u.credits,creditRate:CREDIT_RATE,transactions:tx,topups:tops})});
app.post('/api/topups',auth,upload.single('slip'),(req,res)=>{const amount=Number(req.body.amount),method=['PROMPTPAY','TRUEWALLET','BANK'].includes(req.body.method)?req.body.method:'PROMPTPAY';if(!Number.isFinite(amount)||amount<10||amount>100000)return res.status(400).json({error:'เติมเครดิตขั้นต่ำ 10 บาท และไม่เกิน 100,000 บาท'});if(!req.file)return res.status(400).json({error:'กรุณาแนบสลิป'});const pending=db.prepare("SELECT id FROM topups WHERE username=? AND status='PENDING'").get(req.user);if(pending)return res.status(409).json({error:'มีรายการเติมเงินที่รอตรวจสอบอยู่แล้ว'});const r=db.prepare('INSERT INTO topups(username,amount,method,slip_file,note) VALUES(?,?,?,?,?)').run(req.user,amount,method,req.file.filename,safe(req.body.note,300));res.json({ok:true,id:r.lastInsertRowid,expectedCredits:amount*CREDIT_RATE})});
app.get('/api/topup/slip/:file',admin,(req,res)=>{const f=path.basename(req.params.file);const exists=db.prepare('SELECT id FROM topups WHERE slip_file=?').get(f);if(!exists)return res.status(404).end();const full=path.join(UPLOADS,f);if(!fs.existsSync(full))return res.status(404).end();res.sendFile(full)});
app.get('/api/admin/slip/:file',admin,(req,res)=>{const f=path.basename(req.params.file);const exists=db.prepare('SELECT id FROM topups WHERE slip_file=? UNION SELECT id FROM donations WHERE slip_url=?').get(f,f);if(!exists)return res.status(404).end();const full=path.join(UPLOADS,f);if(!fs.existsSync(full))return res.status(404).end();res.sendFile(full)});

app.post('/api/plan/purchase',auth,(req,res)=>{const p=['PRO','PROMAX'].includes(req.body.plan)?req.body.plan:'PRO',price=PLANS[p].price;const u=db.prepare('SELECT * FROM users WHERE username=?').get(req.user);if(u.credits<price)return res.status(400).json({error:`เครดิตไม่พอ ต้องใช้ ${price} เครดิต`});const exp=new Date(Math.max(Date.now(),Date.parse(u.plan_expires_at)||0)+30*864e5).toISOString();const tx=db.transaction(()=>{const bal=u.credits-price;db.prepare('UPDATE users SET credits=?,plan=?,plan_expires_at=?,usage_count=0 WHERE username=?').run(bal,p,exp,req.user);db.prepare('INSERT INTO credit_transactions(username,amount,balance_after,type,reference,note) VALUES(?,?,?,?,?,?)').run(req.user,-price,bal,'PLAN_PURCHASE',p,`ซื้อ ${p} 30 วัน`)});tx();res.json({ok:true,plan:p,expiresAt:exp})});

// Password reset.
app.post('/api/forgot-password',async(req,res)=>{const email=safe(req.body.email,160).toLowerCase(),x=db.prepare('SELECT username,email FROM users WHERE email=?').get(email);if(!x)return res.json({ok:true});const t=makeToken();db.prepare('UPDATE users SET reset_token_hash=?,reset_expires_at=? WHERE email=?').run(hashToken(t),new Date(Date.now()+3600000).toISOString(),email);const sent=await sendResetEmail(email,t);res.json({ok:true,emailSent:sent,...(!sent?{devResetUrl:siteUrl()+'/reset-password?token='+encodeURIComponent(t)}:{})})});
app.get('/reset-password',(req,res)=>res.sendFile(path.join(__dirname,'public','reset.html')));
app.post('/api/reset-password',(req,res)=>{const t=safe(req.body.token,200),p=String(req.body.password||'');if(!validPassword(p))return res.status(400).json({error:'รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร'});const x=db.prepare('SELECT username FROM users WHERE reset_token_hash=? AND reset_expires_at>?').get(hashToken(t),new Date().toISOString());if(!x)return res.status(400).json({error:'ลิงก์รีเซ็ตไม่ถูกต้องหรือหมดอายุ'});db.prepare("UPDATE users SET password_hash=?,reset_token_hash='',reset_expires_at='' WHERE username=?").run(hashPassword(p),x.username);res.json({ok:true})});

// Admin.
app.post('/api/admin/login',(req,res)=>{if(req.body.username!==ADMIN||req.body.password!==ADMIN_PASSWORD)return res.status(401).json({error:'ข้อมูล Admin ไม่ถูกต้อง'});res.cookie('lufy_admin',sig('admin:'+ADMIN),{httpOnly:true,sameSite:'lax',secure:process.env.NODE_ENV==='production',maxAge:864e5});res.json({ok:true})});
app.get('/api/admin/summary',admin,(req,res)=>{res.json({users:db.prepare('SELECT COUNT(*) c FROM users').get().c,pendingTopups:db.prepare("SELECT COUNT(*) c FROM topups WHERE status='PENDING'").get().c,pendingDonations:db.prepare("SELECT COUNT(*) c FROM donations WHERE status='PENDING'").get().c,credits:db.prepare('SELECT COALESCE(SUM(credits),0) c FROM users').get().c})});
app.get('/api/admin/users',admin,(req,res)=>res.json(db.prepare('SELECT id,username,email,email_verified_at,plan,plan_expires_at,credits,usage_count,created_at FROM users ORDER BY id DESC LIMIT 500').all()));
app.get('/api/admin/topups',admin,(req,res)=>res.json(db.prepare('SELECT * FROM topups ORDER BY id DESC LIMIT 500').all()));
app.post('/api/admin/topup/:id',admin,(req,res)=>{const id=Number(req.params.id),st=req.body.status==='APPROVED'?'APPROVED':'REJECTED',r=db.prepare('SELECT * FROM topups WHERE id=?').get(id);if(!r)return res.status(404).json({error:'ไม่พบรายการ'});if(r.status!=='PENDING')return res.status(409).json({error:'รายการนี้ถูกตรวจแล้ว'});if(st==='REJECTED'){db.prepare("UPDATE topups SET status='REJECTED',reviewed_at=CURRENT_TIMESTAMP,reviewed_by=? WHERE id=?").run(ADMIN,id);return res.json({ok:true})}const u=db.prepare('SELECT credits FROM users WHERE username=?').get(r.username);const add=r.amount*CREDIT_RATE,bal=u.credits+add;db.transaction(()=>{db.prepare("UPDATE topups SET status='APPROVED',reviewed_at=CURRENT_TIMESTAMP,reviewed_by=? WHERE id=?").run(ADMIN,id);db.prepare('UPDATE users SET credits=? WHERE username=?').run(bal,r.username);db.prepare('INSERT INTO credit_transactions(username,amount,balance_after,type,reference,note) VALUES(?,?,?,?,?,?)').run(r.username,add,bal,'TOPUP',String(id),`เติมเงิน ${r.method}`)})();res.json({ok:true,credits:bal})});
app.get('/api/admin/donations',admin,(req,res)=>res.json(db.prepare('SELECT * FROM donations ORDER BY id DESC LIMIT 500').all()));
app.post('/api/admin/donation/:id/status',admin,(req,res)=>{const st=['PENDING','APPROVED','REJECTED'].includes(req.body.status)?req.body.status:'PENDING';const r=db.prepare('UPDATE donations SET status=?,reviewed_at=CURRENT_TIMESTAMP,reviewed_by=? WHERE id=?').run(st,ADMIN,Number(req.params.id));if(!r.changes)return res.status(404).json({error:'ไม่พบรายการ'});res.json({ok:true})});
app.get('/api/admin/videos',admin,(req,res)=>res.json(db.prepare('SELECT * FROM videos ORDER BY id DESC').all()));
app.post('/api/admin/videos',admin,(req,res)=>{const c=safe(req.body.creator,24).toLowerCase(),title=safe(req.body.title,120),url=safe(req.body.url,500),e=embed(url);if(!c||!title||!e)return res.status(400).json({error:'ข้อมูลวิดีโอไม่ถูกต้อง'});const r=db.prepare('INSERT INTO videos(creator,title,url,embed_url) VALUES(?,?,?,?)').run(c,title,url,e);res.json({ok:true,id:r.lastInsertRowid})});
app.delete('/api/admin/videos/:id',admin,(req,res)=>{db.prepare('DELETE FROM videos WHERE id=?').run(Number(req.params.id));res.json({ok:true})});

app.use((err,req,res,next)=>{if(err)return res.status(400).json({error:err.message||'เกิดข้อผิดพลาด'});next()});
app.get('/dashboard',(req,res)=>res.sendFile(path.join(__dirname,'public/dashboard.html')));
app.get('/admin',(req,res)=>res.sendFile(path.join(__dirname,'public/admin.html')));
app.get('/u/:username',(req,res)=>res.sendFile(path.join(__dirname,'public/creator.html')));
app.get('/alert/:username',(req,res)=>res.sendFile(path.join(__dirname,'public/alert.html')));
app.listen(PORT,()=>console.log(`${SITE} running on port ${PORT}`));
