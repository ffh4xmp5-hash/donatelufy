require("dotenv").config();
const express=require("express"), helmet=require("helmet"), cookieParser=require("cookie-parser"), multer=require("multer");
const Database=require("better-sqlite3"), crypto=require("crypto"), path=require("path"), fs=require("fs");
const app=express(), PORT=process.env.PORT||3000, DATA=path.join(__dirname,"data");
const UPLOADS=path.join(DATA,"uploads");
fs.mkdirSync(DATA,{recursive:true}); fs.mkdirSync(UPLOADS,{recursive:true});
const upload=multer({
 storage:multer.diskStorage({
  destination:(req,file,cb)=>cb(null,UPLOADS),
  filename:(req,file,cb)=>cb(null,Date.now()+"-"+crypto.randomBytes(6).toString("hex")+path.extname(file.originalname).toLowerCase())
 }),
 limits:{fileSize:10*1024*1024},
 fileFilter:(req,file,cb)=>{
  const ok=["image/jpeg","image/png","image/webp"].includes(file.mimetype);
  cb(ok?null:new Error("รองรับเฉพาะ JPG, PNG, WEBP"),ok);
 }
});
const db=new Database(path.join(DATA,"lufy-x-donate.db"));
db.pragma("journal_mode=WAL");
try{db.exec("ALTER TABLE users ADD COLUMN truewallet_link TEXT DEFAULT ''")}catch{}
try{db.exec("ALTER TABLE users ADD COLUMN widget_settings TEXT DEFAULT '{}'")}catch{}
try{db.exec("ALTER TABLE users ADD COLUMN password_hash TEXT DEFAULT ''")}catch{}
try{db.exec("ALTER TABLE users ADD COLUMN plan_expires_at TEXT DEFAULT ''")}catch{}
try{db.exec("ALTER TABLE users ADD COLUMN last_login_at TEXT DEFAULT ''")}catch{}
try{db.exec("ALTER TABLE donations ADD COLUMN reviewed_at TEXT DEFAULT ''")}catch{}
try{db.exec("ALTER TABLE donations ADD COLUMN reviewed_by TEXT DEFAULT ''")}catch{}
try{db.exec("ALTER TABLE donations ADD COLUMN payment_method TEXT DEFAULT 'PROMPTPAY'")}catch{}
try{db.exec("ALTER TABLE donations ADD COLUMN slip_url TEXT DEFAULT ''")}catch{}
try{db.exec("ALTER TABLE donations ADD COLUMN wallet_link TEXT DEFAULT ''")}catch{}
try{db.exec("ALTER TABLE donations ADD COLUMN video_url TEXT DEFAULT ''")}catch{}

db.exec(`
CREATE TABLE IF NOT EXISTS users(
 id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL,
 plan TEXT NOT NULL DEFAULT 'FREE', usage_count INTEGER NOT NULL DEFAULT 0,
 display_name TEXT DEFAULT '', bio TEXT DEFAULT '', promptpay TEXT DEFAULT '', truewallet_link TEXT DEFAULT '',
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, widget_settings TEXT DEFAULT '{}', password_hash TEXT DEFAULT '', plan_expires_at TEXT DEFAULT '', last_login_at TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS donations(
 id INTEGER PRIMARY KEY AUTOINCREMENT, creator TEXT NOT NULL, donor TEXT DEFAULT '',
 amount REAL NOT NULL, message TEXT DEFAULT '', status TEXT DEFAULT 'PENDING', payment_method TEXT DEFAULT 'PROMPTPAY', slip_url TEXT DEFAULT '', wallet_link TEXT DEFAULT '', video_url TEXT DEFAULT '',
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, reviewed_at TEXT DEFAULT '', reviewed_by TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS plan_requests(
 id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL, plan TEXT NOT NULL, slip_url TEXT DEFAULT '', status TEXT NOT NULL DEFAULT 'PENDING', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, reviewed_at TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS videos(
 id INTEGER PRIMARY KEY AUTOINCREMENT, creator TEXT NOT NULL, title TEXT NOT NULL,
 url TEXT NOT NULL, embed_url TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, reviewed_at TEXT DEFAULT '', reviewed_by TEXT DEFAULT ''
);
`);
const SITE=process.env.SITE_NAME||"LUFY X DONATE", ADMIN=process.env.ADMIN_USER||"admin",
PASS=process.env.ADMIN_PASSWORD||"change-this-password", SECRET=process.env.SESSION_SECRET||"dev-secret";

app.use(helmet({contentSecurityPolicy:false,crossOriginEmbedderPolicy:false}));
app.use(express.json({limit:"300kb"})); app.use(cookieParser()); app.use(express.static(path.join(__dirname,"public")));

function sig(v){return crypto.createHmac("sha256",SECRET).update(v).digest("hex")}
function hashPassword(password){const salt=crypto.randomBytes(16).toString("hex");const hash=crypto.scryptSync(String(password),salt,64).toString("hex");return salt+":"+hash}
function verifyPassword(password,stored){try{const [salt,hash]=String(stored||"").split(":");if(!salt||!hash)return false;const got=crypto.scryptSync(String(password),salt,64);return crypto.timingSafeEqual(got,Buffer.from(hash,"hex"))}catch{return false}}
function validPassword(p){return typeof p==="string" && p.length>=8 && p.length<=128}
function token(u){let p=Buffer.from(JSON.stringify({u,t:Date.now()})).toString("base64url");return p+"."+sig(p)}
function session(req){try{let [p,s]=(req.cookies.lufy_session||"").split(".");if(!p||s!==sig(p))return null;let x=JSON.parse(Buffer.from(p,"base64url"));return Date.now()-x.t<7*864e5?x.u:null}catch{return null}}
function auth(req,res,next){let u=session(req);if(!u)return res.status(401).json({error:"กรุณาเข้าสู่ระบบ"});req.user=u;next()}
function admin(req,res,next){if(req.cookies.lufy_admin===sig("admin:"+ADMIN))return next();res.status(401).json({error:"ไม่มีสิทธิ์"})}
function limit(plan){return plan==="FREE"?20:Infinity}
function effectivePlan(row){if(!row)return "FREE";if(row.plan!=="FREE"&&row.plan_expires_at&&Date.parse(row.plan_expires_at)<=Date.now())return "FREE";return plan(row.plan)}
function safe(s,n=300){return String(s||"").trim().slice(0,n)}
function yt(url){try{let u=new URL(url),id="";if(u.hostname.includes("youtu.be"))id=u.pathname.slice(1);else if(u.hostname.includes("youtube.com")){if(u.pathname==="/watch")id=u.searchParams.get("v")||"";else if(u.pathname.startsWith("/shorts/"))id=u.pathname.split("/")[2]||"";else if(u.pathname.startsWith("/embed/"))id=u.pathname.split("/")[2]||""}return /^[\w-]{6,20}$/.test(id)?"https://www.youtube.com/embed/"+id:null}catch{return null}}
function embed(url){let y=yt(url);if(y)return y;try{let u=new URL(url);let ok=["tiktok.com","www.tiktok.com","vimeo.com","www.vimeo.com"].some(h=>u.hostname===h||u.hostname.endsWith("."+h));return ok?url:null}catch{return null}}
function plan(p){return ["FREE","PRO","PROMAX"].includes(p)?p:"FREE"}

app.get("/api/config",(q,s)=>s.json({siteName:SITE,promptpayId:process.env.PROMPTPAY_ID||"",plans:{FREE:{price:0,limit:20},PRO:{price:29,limit:null},PROMAX:{price:59,limit:null}}}));
app.post("/api/register",(q,s)=>{let u=safe(q.body.username,24).toLowerCase(),p=String(q.body.password||"");if(!/^[a-z0-9_]{3,24}$/.test(u))return s.status(400).json({error:"Username 3-24 ตัว ใช้ a-z 0-9 _"});if(!validPassword(p))return s.status(400).json({error:"รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร"});try{db.prepare("INSERT INTO users(username,display_name,password_hash) VALUES(?,?,?)").run(u,u,hashPassword(p))}catch{return s.status(409).json({error:"Username นี้มีอยู่แล้ว"})}s.cookie("lufy_session",token(u),{httpOnly:true,sameSite:"lax",secure:process.env.NODE_ENV==="production",maxAge:7*864e5});s.json({ok:true})});
app.post("/api/login",(q,s)=>{let u=safe(q.body.username,24).toLowerCase(),p=String(q.body.password||""),x=db.prepare("SELECT username,password_hash FROM users WHERE username=?").get(u);if(!x)return s.status(401).json({error:"Username หรือรหัสผ่านไม่ถูกต้อง"});if(!verifyPassword(p,x.password_hash))return s.status(401).json({error:"Username หรือรหัสผ่านไม่ถูกต้อง"});db.prepare("UPDATE users SET last_login_at=CURRENT_TIMESTAMP WHERE username=?").run(u);s.cookie("lufy_session",token(u),{httpOnly:true,sameSite:"lax",secure:process.env.NODE_ENV==="production",maxAge:7*864e5});s.json({ok:true})});
app.post("/api/logout",(q,s)=>{s.clearCookie("lufy_session");s.json({ok:true})});
app.get("/api/me",(q,s)=>{let u=session(q);if(!u)return s.json({loggedIn:false});let x=db.prepare("SELECT username,plan,usage_count,display_name,bio,promptpay,truewallet_link,widget_settings,created_at,plan_expires_at FROM users WHERE username=?").get(u);if(!x)return s.json({loggedIn:false});let effective=effectivePlan(x);let l=limit(effective);let settings={};try{settings=JSON.parse(x.widget_settings||'{}')}catch{};s.json({loggedIn:true,...x,plan:effective,widget_settings:settings,limit:Number.isFinite(l)?l:null,remaining:Number.isFinite(l)?Math.max(0,l-x.usage_count):null})});
app.put("/api/profile",auth,(q,s)=>{db.prepare("UPDATE users SET display_name=?,bio=?,promptpay=?,truewallet_link=? WHERE username=?").run(safe(q.body.display_name,80),safe(q.body.bio,300),safe(q.body.promptpay,40),safe(q.body.truewallet_link,500),q.user);s.json({ok:true})});
app.put("/api/widget-settings",auth,(q,s)=>{let current={};try{current=JSON.parse(db.prepare("SELECT widget_settings FROM users WHERE username=?").get(q.user)?.widget_settings||'{}')}catch{};let incoming=q.body||{};let clean={...current};for(const k of ["theme","show_name_amount","show_message","tts","tts_voice","speed","pitch","alert_volume","video_enabled","video_max","video_volume","keyword_filter","widget_style","goal","top_donors","recent","countdown"]){if(k in incoming) clean[k]=incoming[k]}db.prepare("UPDATE users SET widget_settings=? WHERE username=?").run(JSON.stringify(clean),q.user);s.json({ok:true,settings:clean})});
app.get("/api/dashboard/stats",auth,(q,s)=>{let total=db.prepare("SELECT COALESCE(SUM(amount),0) total FROM donations WHERE creator=?").get(q.user).total;let count=db.prepare("SELECT COUNT(*) count FROM donations WHERE creator=?").get(q.user).count;let recent=db.prepare("SELECT donor,amount,message,created_at FROM donations WHERE creator=? ORDER BY id DESC LIMIT 5").all(q.user);s.json({total,count,recent})});
app.post("/api/use",auth,(q,s)=>{let x=db.prepare("SELECT plan,usage_count FROM users WHERE username=?").get(q.user),l=limit(x.plan);if(Number.isFinite(l)&&x.usage_count>=l)return s.status(429).json({error:"FREE ครบ 20 ครั้งแล้ว กรุณาอัปเกรด PRO/PROMAX"});db.prepare("UPDATE users SET usage_count=usage_count+1 WHERE username=?").run(q.user);s.json({ok:true})});
app.get("/api/creator/:u",(q,s)=>{let x=db.prepare("SELECT username,plan,display_name,bio,promptpay,truewallet_link FROM users WHERE username=?").get(safe(q.params.u,24).toLowerCase());if(!x)return s.status(404).json({error:"ไม่พบหน้า Creator"});s.json(x)});
app.post("/api/donate/:u",upload.single("slip"),(q,s)=>{
 let c=safe(q.params.u,24).toLowerCase();
 let x=db.prepare("SELECT username,plan,usage_count,truewallet_link,widget_settings,plan_expires_at FROM users WHERE username=?").get(c);
 if(!x)return s.status(404).json({error:"ไม่พบ Creator"});
 let amount=Number(q.body.amount); if(!Number.isFinite(amount)||amount<1||amount>1e7)return s.status(400).json({error:"จำนวนเงินไม่ถูกต้อง"});
 let creatorPlan=effectivePlan(x); let method=["PROMPTPAY","TRUEWALLET"].includes(q.body.payment_method)?q.body.payment_method:"PROMPTPAY";
 let wallet=safe(q.body.wallet_link,500), video=safe(q.body.video_url,500), slip=q.file?"/api/admin/slip/"+encodeURIComponent(q.file.filename):"";
 let settings={}; try{settings=JSON.parse(x.widget_settings||"{}")}catch{}
 let max=limit(creatorPlan); if(Number.isFinite(max)&&x.usage_count>=max)return s.status(429).json({error:"แพ็กเกจ FREE ครบ 20 รายการแล้ว กรุณาอัปเกรด"});
 if(method==="PROMPTPAY"&&!slip)return s.status(400).json({error:"กรุณาแนบสลิปสำหรับ PromptPay"});
 if(method==="TRUEWALLET"&&!x.truewallet_link)return s.status(400).json({error:"Creator ยังไม่ได้ตั้งค่าลิงก์ซองอั่งเปา"});
 if(method==="TRUEWALLET"&&wallet&&wallet!==x.truewallet_link)return s.status(400).json({error:"ลิงก์ซองอั่งเปาไม่ตรงกับ Creator"});
 if(creatorPlan!=="PROMAX"||settings.video_enabled===false)video="";
 if(video&&!/^https?:\/\//i.test(video))return s.status(400).json({error:"ลิงก์วิดีโอไม่ถูกต้อง"});
 let message=safe(q.body.message,300); if(settings.keyword_filter!==false){message=message.replace(/(?:เหี้ย|สัส|ควย|เย็ด|แม่ง)/gi,"***")}
 const tx=db.transaction(()=>{let info=db.prepare("INSERT INTO donations(creator,donor,amount,message,payment_method,slip_url,wallet_link,video_url) VALUES(?,?,?,?,?,?,?,?)").run(c,safe(q.body.donor,60),amount,message,method,slip,wallet,video);db.prepare("UPDATE users SET usage_count=usage_count+1 WHERE username=?").run(c);return info.lastInsertRowid});
 let id=tx(); s.json({ok:true,id,slip_url:slip});
});
app.get("/api/donations/:u",(q,s)=>s.json(db.prepare("SELECT id,donor,amount,message,status,created_at,video_url,payment_method FROM donations WHERE creator=? ORDER BY id DESC LIMIT 100").all(safe(q.params.u,24).toLowerCase())))
app.get("/api/videos/:u",(q,s)=>s.json(db.prepare("SELECT * FROM videos WHERE creator=? ORDER BY id DESC").all(safe(q.params.u,24).toLowerCase())));

app.get("/api/admin/slip/:file",admin,(q,s)=>{let f=path.basename(q.params.file);let full=path.join(UPLOADS,f);if(!fs.existsSync(full))return s.status(404).end();s.sendFile(full)});
app.get("/api/plan-requests",auth,(q,s)=>s.json(db.prepare("SELECT id,plan,status,created_at FROM plan_requests WHERE username=? ORDER BY id DESC LIMIT 20").all(q.user)));
app.post("/api/plan-requests",auth,upload.single("slip"),(q,s)=>{let p=plan(q.body.plan);if(p==="FREE")return s.status(400).json({error:"เลือก PRO หรือ PROMAX"});let existing=db.prepare("SELECT id FROM plan_requests WHERE username=? AND status='PENDING'").get(q.user);if(existing)return s.status(409).json({error:"มีคำขอรอตรวจสอบอยู่แล้ว"});let slip=q.file?"/api/admin/slip/"+encodeURIComponent(q.file.filename):"";if(!slip)return s.status(400).json({error:"กรุณาแนบสลิป"});let r=db.prepare("INSERT INTO plan_requests(username,plan,slip_url) VALUES(?,?,?)").run(q.user,p,slip);s.json({ok:true,id:r.lastInsertRowid})});
app.post("/api/admin/login",(q,s)=>{if(q.body.username!==ADMIN||q.body.password!==PASS)return s.status(401).json({error:"ข้อมูล Admin ไม่ถูกต้อง"});s.cookie("lufy_admin",sig("admin:"+ADMIN),{httpOnly:true,sameSite:"lax",maxAge:864e5});s.json({ok:true})});
app.post("/api/admin/plan",admin,(q,s)=>{let r=db.prepare("UPDATE users SET plan=?,plan_expires_at=? WHERE username=?").run(plan(q.body.plan),plan(q.body.plan)==="FREE"?"":new Date(Date.now()+30*864e5).toISOString(),safe(q.body.username,24).toLowerCase());if(!r.changes)return s.status(404).json({error:"ไม่พบผู้ใช้"});s.json({ok:true})});
app.post("/api/admin/reset",admin,(q,s)=>{db.prepare("UPDATE users SET usage_count=0 WHERE username=?").run(safe(q.body.username,24).toLowerCase());s.json({ok:true})});
app.get("/api/admin/plan-requests",admin,(q,s)=>s.json(db.prepare("SELECT * FROM plan_requests ORDER BY id DESC LIMIT 300").all()));
app.post("/api/admin/plan-request/:id",admin,(q,s)=>{let r=db.prepare("SELECT * FROM plan_requests WHERE id=?").get(Number(q.params.id));if(!r)return s.status(404).json({error:"ไม่พบคำขอ"});let st=["APPROVED","REJECTED"].includes(q.body.status)?q.body.status:"REJECTED";const tx=db.transaction(()=>{db.prepare("UPDATE plan_requests SET status=?,reviewed_at=CURRENT_TIMESTAMP WHERE id=?").run(st,r.id);if(st==="APPROVED")db.prepare("UPDATE users SET plan=?,usage_count=0,plan_expires_at=? WHERE username=?").run(r.plan,new Date(Date.now()+30*864e5).toISOString(),r.username)});tx();s.json({ok:true})});
app.post("/api/admin/donation/:id/status",admin,(q,s)=>{let st=["PENDING","APPROVED","REJECTED"].includes(q.body.status)?q.body.status:"PENDING";let r=db.prepare("UPDATE donations SET status=?,reviewed_at=CURRENT_TIMESTAMP,reviewed_by=? WHERE id=?").run(st,ADMIN,Number(q.params.id));if(!r.changes)return s.status(404).json({error:"ไม่พบรายการ"});s.json({ok:true})});
app.get("/api/admin/users",admin,(q,s)=>s.json(db.prepare("SELECT id,username,plan,usage_count,display_name,created_at FROM users ORDER BY id DESC").all()));
app.get("/api/admin/donations",admin,(q,s)=>s.json(db.prepare("SELECT * FROM donations ORDER BY id DESC LIMIT 300").all()));
app.get("/api/admin/videos",admin,(q,s)=>s.json(db.prepare("SELECT * FROM videos ORDER BY id DESC").all()));
app.post("/api/admin/videos",admin,(q,s)=>{let creator=safe(q.body.creator,24).toLowerCase(),title=safe(q.body.title,120),url=safe(q.body.url,500),e=embed(url);if(!creator||!title||!e)return s.status(400).json({error:"Creator/ชื่อ/URL ไม่ถูกต้อง"});let r=db.prepare("INSERT INTO videos(creator,title,url,embed_url) VALUES(?,?,?,?)").run(creator,title,url,e);s.json({ok:true,id:r.lastInsertRowid})});
app.delete("/api/admin/videos/:id",admin,(q,s)=>{db.prepare("DELETE FROM videos WHERE id=?").run(Number(q.params.id));s.json({ok:true})});

app.use((err,q,s,n)=>{if(err){return s.status(400).json({error:err.message||"อัปโหลดไม่สำเร็จ"})}n()});
app.get("/dashboard",(q,s)=>s.sendFile(path.join(__dirname,"public/dashboard.html")));
app.get("/admin",(q,s)=>s.sendFile(path.join(__dirname,"public/admin.html")));
app.get("/u/:username",(q,s)=>s.sendFile(path.join(__dirname,"public/creator.html")));
app.get("/alert/:username",(q,s)=>s.sendFile(path.join(__dirname,"public/alert.html")));
app.use((q,s)=>s.sendFile(path.join(__dirname,"public/index.html")));
app.listen(PORT,()=>console.log(`${SITE} running on port ${PORT}`));
